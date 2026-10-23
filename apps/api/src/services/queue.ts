import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { Submission } from '../models/Submission.js';
import { Analysis } from '../models/Analysis.js';
import { storage } from '../utils/storage.js';
import { analysisContractSchema, AnalysisContract } from '../utils/aiContract.js';
import { triggerFamilyAlerts } from './alertService.js';

export interface SubmissionJobData {
  submissionId: string;
}

export async function processSubmission(submissionId: string): Promise<void> {
  const submission = await Submission.findById(submissionId);
  if (!submission) {
    logger.error({ submissionId }, 'Submission not found in worker');
    return;
  }

  logger.info({ submissionId: submission._id, mode: submission.mode }, 'Worker processing submission');
  submission.status = 'processing';
  await submission.save();

  try {
    // 1. Prepare payload for AI service
    const formData = new FormData();
    formData.append('mode', submission.mode);
    formData.append('language', submission.language || 'en');
    formData.append('submissionId', submission._id.toString());

    if (submission.rawTextMasked) {
      formData.append('text', submission.rawTextMasked);
    }

    if (submission.storageKey) {
      try {
        const decryptedBuffer = await storage.read(submission.storageKey);
        const mimeType = submission.mimeType || 'application/octet-stream';
        const filename = submission.originalFileName || 'upload.bin';
        const blob = new Blob([new Uint8Array(decryptedBuffer)], { type: mimeType });
        formData.append('file', blob, filename);
      } catch (err: any) {
        logger.error({ err, storageKey: submission.storageKey }, 'Failed to read media from storage');
      }
    }

    // 2. Call AI service with timeout and resilient port fallback
    let validatedAnalysis: AnalysisContract | null = null;
    let attempt = 0;
    const maxAttempts = 2;
    let lastError: any = null;
    let targetUrl = `${env.AI_SERVICE_URL.replace('localhost', '127.0.0.1')}/analyze`;

    while (attempt < maxAttempts && !validatedAnalysis) {
      attempt++;
      try {
        logger.info({ targetUrl, attempt, submissionId }, 'Calling AI analysis service');

        const aiResponse = await fetch(targetUrl, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(15000)
        });

        if (!aiResponse.ok) {
          throw new Error(`AI service HTTP ${aiResponse.status}: ${await aiResponse.text()}`);
        }

        const json = await aiResponse.json();

        // 3. Strict Zod validation against contract
        const parseResult = analysisContractSchema.safeParse(json);
        if (!parseResult.success) {
          logger.warn(
            { errors: parseResult.error.errors, attempt },
            'AI service returned invalid schema. Retrying...'
          );
          lastError = new Error(`Invalid response schema: ${parseResult.error.message}`);
        } else {
          validatedAnalysis = parseResult.data;
        }
      } catch (err: any) {
        lastError = err;
        logger.warn({ err: err.message, attempt, targetUrl }, 'Error calling AI service');

        // Resilient local port fallback (5001 <-> 5002) if connection refused
        if (targetUrl.includes(':5001')) {
          targetUrl = targetUrl.replace(':5001', ':5002');
        } else if (targetUrl.includes(':5002')) {
          targetUrl = targetUrl.replace(':5002', ':5001');
        }
      }
    }

    if (!validatedAnalysis) {
      throw lastError || new Error('Failed to obtain a valid analysis response from AI service');
    }

    // 4. Save Analysis document in MongoDB
    const analysis = await Analysis.findOneAndUpdate(
      { submissionId: submission._id },
      {
        submissionId: submission._id,
        userId: submission.userId,
        mode: validatedAnalysis.mode,
        risk: validatedAnalysis.risk,
        verdict: validatedAnalysis.verdict,
        confidence: validatedAnalysis.confidence,
        summary: validatedAnalysis.summary,
        tactics: validatedAnalysis.tactics,
        findings: validatedAnalysis.findings,
        clauses: validatedAnalysis.clauses,
        deadlines: validatedAnalysis.deadlines,
        safeSteps: validatedAnalysis.safeSteps,
        drafts: validatedAnalysis.drafts,
        audioUrl: validatedAnalysis.audioUrl,
        escalate: validatedAnalysis.escalate,
        disclaimer: validatedAnalysis.disclaimer
      },
      { upsert: true, new: true }
    );

    // 5. Trigger family alert rules based on active consent and risk threshold
    try {
      await triggerFamilyAlerts(submission, analysis);
    } catch (alertErr: any) {
      logger.error({ err: alertErr.message, submissionId: submission._id }, 'Alert trigger warning (non-fatal)');
    }

    // 6. Update submission status to done
    submission.status = 'done';
    submission.error = undefined;
    await submission.save();

    logger.info(
      { submissionId: submission._id, verdict: analysis.verdict, risk: analysis.risk },
      'Submission successfully analyzed'
    );
  } catch (err: any) {
    logger.error({ err: err.message, submissionId: submission._id }, 'Submission analysis failed');
    submission.retryCount = (submission.retryCount || 0) + 1;

    if (submission.retryCount >= 2) {
      submission.status = 'failed';
      submission.error =
        'We were unable to analyze this submission after multiple attempts. Please try submitting again or contact support.';
    } else {
      submission.status = 'queued'; // Allow one retry
    }
    await submission.save();
    throw err;
  }
}

// In-process fallback queue with safe execution and retry dispatching
class InProcessQueue {
  private queue: string[] = [];
  private processing = false;

  async add(submissionId: string) {
    if (!this.queue.includes(submissionId)) {
      this.queue.push(submissionId);
    }
    this.run();
  }

  private async run() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const submissionId = this.queue.shift();
        if (submissionId) {
          try {
            await processSubmission(submissionId);
          } catch (err: any) {
            logger.error({ err: err.message, submissionId }, 'In-process queue job failed');

            // If the job was marked for a retry, schedule re-dispatch
            try {
              const sub = await Submission.findById(submissionId);
              if (sub && sub.status === 'queued') {
                logger.info(
                  { submissionId, retryCount: sub.retryCount },
                  'Scheduling retry dispatch for queued submission'
                );
                setTimeout(() => {
                  this.add(submissionId);
                }, 2000);
              }
            } catch (dbErr: any) {
              logger.error({ dbErr: dbErr.message }, 'Failed to check submission retry status');
            }
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }
}

// Queue Manager: BullMQ with automatic InProcess fallback and startup recovery
export class QueueManager {
  private inProcessQueue: InProcessQueue = new InProcessQueue();
  private bullQueue: Queue | null = null;
  private worker: Worker | null = null;
  private useRedis = false;
  private recoveryInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.init();
  }

  private async init() {
    if (!env.REDIS_URL) {
      logger.info('REDIS_URL not configured. Operating with in-process job queue.');
      return;
    }

    try {
      const redisConnection = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000
      });

      redisConnection.on('error', (err: any) => {
        logger.warn({ err: err.message }, 'Redis connection error. Falling back to in-process queue.');
        this.useRedis = false;
      });

      await redisConnection.ping();
      this.useRedis = true;

      this.bullQueue = new Queue('submission-analysis', { connection: redisConnection });
      this.worker = new Worker(
        'submission-analysis',
        async (job: Job<SubmissionJobData>) => {
          await processSubmission(job.data.submissionId);
        },
        {
          connection: redisConnection,
          concurrency: 5
        }
      );

      logger.info('Connected to Redis BullMQ queue.');
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Unable to connect to Redis. Using in-process queue fallback.');
      this.useRedis = false;
    }
  }

  /**
   * Recovers any submissions in MongoDB that were left queued or stuck processing during restart.
   */
  async recoverPendingSubmissions(): Promise<number> {
    try {
      const queuedSubs = await Submission.find({ status: 'queued' }).sort({ createdAt: 1 });

      // Recover submissions stuck in 'processing' for > 60 seconds (orphaned by crash)
      const oneMinuteAgo = new Date(Date.now() - 60000);
      const stuckSubs = await Submission.find({
        status: 'processing',
        updatedAt: { $lt: oneMinuteAgo }
      });

      for (const sub of stuckSubs) {
        sub.status = 'queued';
        await sub.save();
        queuedSubs.push(sub);
      }

      for (const sub of queuedSubs) {
        logger.info({ submissionId: sub._id }, 'Recovering and enqueuing pending submission');
        await this.enqueue(sub._id.toString());
      }

      if (queuedSubs.length > 0) {
        logger.info({ count: queuedSubs.length }, 'Recovered pending submissions from database');
      }
      return queuedSubs.length;
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to recover pending submissions');
      return 0;
    }
  }

  /**
   * Starts the worker/queue manager and initializes recovery sweeps.
   */
  start(): void {
    // Initial recovery on startup
    this.recoverPendingSubmissions();

    // Periodic sweep for in-process mode (every 15s) to guarantee no submission stays orphaned
    if (!this.useRedis && !this.recoveryInterval) {
      this.recoveryInterval = setInterval(() => {
        this.recoverPendingSubmissions();
      }, 15000);
    }
  }

  /**
   * Graceful shutdown of the queue manager.
   */
  stop(): void {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
    if (this.worker) {
      this.worker.close();
    }
  }

  async enqueue(submissionId: string): Promise<void> {
    if (this.useRedis && this.bullQueue) {
      try {
        await this.bullQueue.add(
          'analyze',
          { submissionId },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 100
          }
        );
        return;
      } catch (err: any) {
        logger.warn({ err: err.message }, 'BullMQ enqueue failed. Falling back to in-process queue.');
      }
    }

    await this.inProcessQueue.add(submissionId);
  }
}

export const submissionQueue = new QueueManager();
