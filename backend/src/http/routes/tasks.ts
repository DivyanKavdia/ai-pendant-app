/**
 * Internal worker endpoint.
 *
 * Only Cloud Tasks may call this, authenticated with an OIDC token minted for
 * our own service account. It is mounted under /v1 like everything else so a
 * single Cloud Run service can serve both, but it takes no user session and
 * exposes no data.
 */

import { Router } from 'express';
import { z } from 'zod';
import { processRecording } from '../../pipeline/process.js';
import { log } from '../../util/log.js';
import { requireTaskAuth } from '../auth.js';
import { HttpError, handler } from '../errors.js';

const taskBody = z.object({
  uid: z.string().min(1),
  recordingId: z.string().min(1),
});

export function taskRoutes(): Router {
  const router = Router();

  router.post(
    '/tasks/process',
    requireTaskAuth(),
    handler(async (req, res) => {
      const body = taskBody.safeParse(req.body);
      if (!body.success) throw new HttpError(400, 'bad_request', 'uid and recordingId are required');

      const { uid, recordingId } = body.data;
      try {
        await processRecording(uid, recordingId);
        res.status(200).json({ state: 'ready' });
      } catch (cause) {
        const message = (cause as Error).message ?? '';
        // A 4xx tells Cloud Tasks to stop retrying. Reserve it for failures that
        // will never succeed — a missing recording, no audio at all. Everything
        // else gets a 5xx so the queue's backoff can do its job.
        const permanent = /unknown (user|recording)|no segments|no audio/i.test(message);
        log.error('Task processing failed', { uid, recordingId, permanent, error: message });
        res.status(permanent ? 400 : 500).json({
          error: { code: permanent ? 'permanent' : 'transient', message },
        });
      }
    }),
  );

  return router;
}
