import { Router } from 'express';
import { z } from 'zod';
import { openJson } from '../../crypto/envelope.js';
import { keyring } from '../../crypto/keyring.js';
import * as db from '../../store/firestore.js';
import type { UserProfile } from '../../store/types.js';
import { deleteUserAudio } from '../../store/gcs.js';
import { log } from '../../util/log.js';
import {
  issueTokens,
  refreshSession,
  requireAuth,
  upsertUserFromGoogle,
  verifyGoogleIdToken,
  type AuthedRequest,
} from '../auth.js';
import { HttpError, handler } from '../errors.js';

const exchangeBody = z.object({ id_token: z.string().min(16) });
const refreshBody = z.object({ refresh_token: z.string().min(16) });

export function authRoutes(): Router {
  const router = Router();

  /** Exchange a Google ID token for a Synap session. */
  router.post(
    '/auth/google',
    handler(async (req, res) => {
      const body = exchangeBody.safeParse(req.body);
      if (!body.success) throw new HttpError(400, 'bad_request', 'id_token is required');

      const payload = await verifyGoogleIdToken(body.data.id_token);
      const user = await upsertUserFromGoogle(payload);
      const tokens = await issueTokens(user);

      log.info('Sign-in', { uid: user.uid });
      res.status(200).json({
        ...tokens,
        user: { uid: user.uid, created_at: user.createdAt },
      });
    }),
  );

  router.post(
    '/auth/refresh',
    handler(async (req, res) => {
      const body = refreshBody.safeParse(req.body);
      if (!body.success) throw new HttpError(400, 'bad_request', 'refresh_token is required');
      res.status(200).json(await refreshSession(body.data.refresh_token));
    }),
  );

  /** Who am I. The profile is sealed at rest and opened only for its owner. */
  router.get(
    '/auth/me',
    requireAuth(),
    handler<AuthedRequest>(async (req, res) => {
      const profile = openJson<UserProfile>(req.dek, req.user.sealedProfile, {
        uid: req.uid,
        scope: `user/${req.uid}`,
        field: 'profile',
      });
      res.status(200).json({
        uid: req.uid,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        created_at: req.user.createdAt,
        audio_retention_days: req.user.audioRetentionDays,
      });
    }),
  );

  /** Sign out everywhere: invalidates every outstanding refresh token at once. */
  router.post(
    '/auth/signout',
    requireAuth(),
    handler<AuthedRequest>(async (req, res) => {
      await db.bumpTokenGeneration(req.uid);
      keyring.forget(req.uid);
      res.status(204).end();
    }),
  );

  /**
   * Account deletion. Audio objects and Firestore documents go first; the
   * wrapped DEK is destroyed last, so an interruption anywhere in the sequence
   * still leaves every remaining byte permanently unreadable.
   */
  router.delete(
    '/auth/me',
    requireAuth(),
    handler<AuthedRequest>(async (req, res) => {
      await deleteUserAudio(req.uid);
      await db.deleteUser(req.uid);
      keyring.forget(req.uid);
      log.info('Account deleted', { uid: req.uid });
      res.status(204).end();
    }),
  );

  return router;
}
