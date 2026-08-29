import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "../auth.js";

export interface AuthenticatedRequest extends Request {
	userId?: string;
	userEmail?: string;
}

/** Resolves the Better Auth session from the bearer token; 401 when absent or expired. */
export function createRequireUser(auth: Auth) {
	return async function requireUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
		try {
			const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
			if (!session) {
				res.status(401).json({ error: "Not authenticated." });
				return;
			}
			req.userId = session.user.id;
			req.userEmail = session.user.email;
			next();
		} catch (error) {
			console.error("Session lookup failed:", error);
			res.status(401).json({ error: "Not authenticated." });
		}
	};
}
