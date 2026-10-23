import { Router } from 'express';
import { z } from 'zod';
import { deleteEverything, type DeleteReport } from '../users/delete-everything';

export interface UsersDeps {
  deleteEverything: (userId: string) => Promise<DeleteReport>;
}

/**
 * Mounted behind requireInternalSecret (index.ts): the backend's account
 * deletion (BE0.7) is the only caller, just before it deletes the `users` row.
 */
export function makeUsersRouter(deps: Partial<UsersDeps> = {}): Router {
  const d: UsersDeps = { deleteEverything: (userId) => deleteEverything(userId), ...deps };
  const router = Router();

  /**
   * POST /users/:userId/delete
   * Body: { confirm: "delete" }. Revokes every OAuth grant and deletes every
   * stored file of this person; deletes no row. Answers
   * `{ grantsRevoked, grantsFailed, grantsNothingToRevoke, objectsDeleted: { <bucket>: n }, objectsSkipped, ok, failedSteps }`:
   * 200 when everything is gone, 500 with the same report when a step did not
   * finish (call again: it is idempotent, and a second call reports zeros).
   */
  router.post('/:userId/delete', async (req, res) => {
    const userId = z.string().uuid().safeParse(req.params.userId);
    if (!userId.success) return res.status(400).json({ error: 'invalid userId' });
    if (req.body?.confirm !== 'delete') return res.status(400).json({ error: 'confirm must be "delete"' });
    try {
      const report = await d.deleteEverything(userId.data);
      return res.status(report.ok ? 200 : 500).json(report);
    } catch {
      // No message: a storage or database error can carry a path.
      console.error(`[user-delete] user=${userId.data} unexpected failure`);
      return res.status(500).json({ error: 'delete failed', ok: false });
    }
  });

  return router;
}

export const usersRouter = makeUsersRouter();
