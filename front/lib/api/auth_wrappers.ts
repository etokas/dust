import { DustUserEmailHeader } from "@dust-tt/client";
import type {
  UserTypeWithWorkspaces,
  WithAPIErrorResponse,
} from "@dust-tt/types";
import type { NextApiRequest, NextApiResponse } from "next";

import type { MethodType, ScopeType } from "@app/lib/api/auth0";
import {
  getRequiredScope,
  getUserFromAuth0Token,
  verifyAuth0Token,
} from "@app/lib/api/auth0";
import { getUserWithWorkspaces } from "@app/lib/api/user";
import {
  Authenticator,
  getAPIKey,
  getAuthType,
  getBearerToken,
} from "@app/lib/auth";
import { getSession } from "@app/lib/auth";
import { getGroupIdsFromHeaders } from "@app/lib/http_api/group_header";
import type { SessionWithUser } from "@app/lib/iam/provider";
import logger from "@app/logger/logger";
import { apiError, withLogging } from "@app/logger/withlogging";

/**
 * This function is a wrapper for API routes that require session authentication.
 *
 * @param handler
 * @param param1
 * @returns
 */
export function withSessionAuthentication<T>(
  handler: (
    req: NextApiRequest,
    res: NextApiResponse<WithAPIErrorResponse<T>>,
    session: SessionWithUser
  ) => Promise<void> | void,
  { isStreaming = false }: { isStreaming?: boolean } = {}
) {
  return withLogging(
    async (
      req: NextApiRequest,
      res: NextApiResponse<WithAPIErrorResponse<T>>
    ) => {
      const session = await getSession(req, res);

      if (!session) {
        return apiError(req, res, {
          status_code: 401,
          api_error: {
            type: "not_authenticated",
            message:
              "The user does not have an active session or is not authenticated.",
          },
        });
      }

      return handler(req, res, session);
    },
    isStreaming
  );
}

/**
 * This function is a wrapper for API routes that require session authentication for a workspace.
 * It must be used on all routes that require workspace authentication (prefix: /w/[wId]/).
 *
 * opts.allowUserOutsideCurrentWorkspace allows the handler to be called even if the user is not a
 * member of the workspace. This is useful for routes that share data across workspaces (eg apps
 * runs).
 *
 * @param handler
 * @param opts
 * @returns
 */
export function withSessionAuthenticationForWorkspace<T>(
  handler: (
    req: NextApiRequest,
    res: NextApiResponse<WithAPIErrorResponse<T>>,
    auth: Authenticator,
    session: SessionWithUser
  ) => Promise<void> | void,
  opts: {
    isStreaming?: boolean;
    allowUserOutsideCurrentWorkspace?: boolean;
  } = {}
) {
  return withSessionAuthentication(
    async (
      req: NextApiRequest,
      res: NextApiResponse<WithAPIErrorResponse<T>>,
      session: SessionWithUser
    ) => {
      const { wId } = req.query;
      if (typeof wId !== "string" || !wId) {
        return apiError(req, res, {
          status_code: 404,
          api_error: {
            type: "workspace_not_found",
            message: "The workspace was not found.",
          },
        });
      }

      const auth = await Authenticator.fromSession(session, wId);

      const owner = auth.workspace();
      const plan = auth.plan();
      if (!owner || !plan) {
        return apiError(req, res, {
          status_code: 404,
          api_error: {
            type: "workspace_not_found",
            message: "The workspace was not found.",
          },
        });
      }

      const user = auth.user();
      if (!user) {
        return apiError(req, res, {
          status_code: 404,
          api_error: {
            type: "workspace_user_not_found",
            message: "Could not find the user of the current session.",
          },
        });
      }

      // If `allowUserOutsideCurrentWorkspace` is not set or false then we check that the user is a
      // member of the workspace.
      if (!auth.isUser() && !opts.allowUserOutsideCurrentWorkspace) {
        return apiError(req, res, {
          status_code: 401,
          api_error: {
            type: "workspace_auth_error",
            message: "Only users of the workspace can access this route.",
          },
        });
      }

      return handler(req, res, auth, session);
    },
    opts
  );
}

/**
 * This function is a wrapper for Public API routes that require authentication for a workspace.
 * It must be used on all routes that require workspace authentication (prefix: /v1/w/[wId]/).
 *
 * opts.allowUserOutsideCurrentWorkspace allows the handler to be called even if the key is not a
 * associated with the workspace. This is useful for routes that share data across workspaces (eg apps
 * runs).
 *
 * @param handler
 * @param opts
 * @returns
 */
export function withPublicAPIAuthentication<T, U extends boolean>(
  handler: (
    req: NextApiRequest,
    res: NextApiResponse<WithAPIErrorResponse<T>>,
    auth: Authenticator,
    keyAuth: U extends true ? Authenticator : null
  ) => Promise<void> | void,
  opts: {
    isStreaming?: boolean;
    allowUserOutsideCurrentWorkspace?: U;
    requiredScopes?: Partial<Record<MethodType, ScopeType>>;
  } = {}
) {
  const { allowUserOutsideCurrentWorkspace, isStreaming } = opts;

  return withLogging(
    async (
      req: NextApiRequest,
      res: NextApiResponse<WithAPIErrorResponse<T>>
    ) => {
      const wId = typeof req.query.wId === "string" ? req.query.wId : undefined;
      if (!wId) {
        return apiError(req, res, {
          status_code: 404,
          api_error: {
            type: "workspace_not_found",
            message: "The workspace was not found.",
          },
        });
      }

      const bearerTokenRes = await getBearerToken(req);
      if (bearerTokenRes.isErr()) {
        return apiError(req, res, {
          status_code: 401,
          api_error: {
            type: "not_authenticated",
            message:
              "The request does not have valid authentication credentials.",
          },
        });
      }
      const token = bearerTokenRes.value;
      const authMethod = getAuthType(token);

      // Authentification with Auth0 token.
      // Straightforward since the token is attached to the user.
      if (authMethod === "access_token") {
        const decoded = await verifyAuth0Token(
          token,
          getRequiredScope(req, opts.requiredScopes)
        );
        if (decoded.isErr()) {
          logger.error(decoded.error, "Failed to verify Auth0 token");
          return apiError(req, res, {
            status_code: 401,
            api_error: {
              type: "not_authenticated",
              message:
                "The request does not have valid authentication credentials.",
            },
          });
        }

        const auth = await Authenticator.fromAuth0Token({
          token: decoded.value,
          wId,
        });
        if (auth.user() === null) {
          return apiError(req, res, {
            status_code: 401,
            api_error: {
              type: "not_authenticated",
              message:
                "The user does not have an active session or is not authenticated.",
            },
          });
        }
        if (!auth.isUser()) {
          return apiError(req, res, {
            status_code: 401,
            api_error: {
              type: "workspace_auth_error",
              message: "Only users of the workspace can access this route.",
            },
          });
        }
        return handler(
          req,
          res,
          auth,
          null as U extends true ? Authenticator : null
        );
      }

      // Authentification with an API key.
      const keyRes = await getAPIKey(req);
      if (keyRes.isErr()) {
        return apiError(req, res, keyRes.error);
      }

      const keyAndWorkspaceAuth = await Authenticator.fromKey(
        keyRes.value,
        wId,
        getGroupIdsFromHeaders(req.headers)
      );
      const { keyAuth } = keyAndWorkspaceAuth;
      let { workspaceAuth } = keyAndWorkspaceAuth;

      const owner = workspaceAuth.workspace();
      const plan = workspaceAuth.plan();
      if (!owner || !plan) {
        return apiError(req, res, {
          status_code: 404,
          api_error: {
            type: "workspace_not_found",
            message: "The workspace was not found.",
          },
        });
      }

      // Authenticator created from the a key has the builder role if the key is associated with
      // the workspace.
      if (!workspaceAuth.isBuilder() && !allowUserOutsideCurrentWorkspace) {
        return apiError(req, res, {
          status_code: 401,
          api_error: {
            type: "workspace_auth_error",
            message: "Only users of the workspace can access this route.",
          },
        });
      }

      // NOTE: This section is for internal use only!
      // If the "x-api-user-email" header is present and contains a valid email address, attempt
      // to exchange the current workspace authentication for user authentication.
      // This operation is only performed if:
      // 1. The user associated with the email is a member of the current workspace.
      // 2. The system key is being used for authentication.
      const userEmailFromHeader = req.headers[DustUserEmailHeader];
      if (
        typeof userEmailFromHeader === "string" &&
        !allowUserOutsideCurrentWorkspace
      ) {
        workspaceAuth =
          (await workspaceAuth.exchangeSystemKeyForUserAuthByEmail(
            workspaceAuth,
            {
              userEmail: userEmailFromHeader,
            }
          )) ?? workspaceAuth;
      }

      const apiKey = keyAuth.key();

      logger.info(
        {
          method: req.method,
          url: req.url,
          key: apiKey ? { id: apiKey.id, name: apiKey.name } : null,
        },
        "withPublicAPIAuthentication request"
      );

      return handler(
        req,
        res,
        workspaceAuth,
        (opts.allowUserOutsideCurrentWorkspace
          ? keyAuth
          : null) as U extends true ? Authenticator : null
      );
    },
    isStreaming
  );
}

/**
 * This function is a wrapper for Public API routes that require authentication without a workspace with a token from Auth0.
 */
export function withAuth0TokenAuthentication<T>(
  handler: (
    req: NextApiRequest,
    res: NextApiResponse<WithAPIErrorResponse<T>>,
    user: UserTypeWithWorkspaces
  ) => Promise<void> | void,
  opts: {
    requiredScopes?: Partial<Record<MethodType, ScopeType>>;
  } = {}
) {
  return withLogging(
    async (
      req: NextApiRequest,
      res: NextApiResponse<WithAPIErrorResponse<T>>
    ) => {
      const bearerTokenRes = await getBearerToken(req);
      if (bearerTokenRes.isErr()) {
        return apiError(req, res, {
          status_code: 401,
          api_error: {
            type: "not_authenticated",
            message:
              "The request does not have valid authentication credentials.",
          },
        });
      }
      const bearerToken = bearerTokenRes.value;
      const authMethod = getAuthType(bearerToken);

      if (authMethod !== "access_token") {
        return apiError(req, res, {
          status_code: 401,
          api_error: {
            type: "not_authenticated",
            message:
              "The request does not have valid authentication credentials.",
          },
        });
      }

      const decoded = await verifyAuth0Token(
        bearerToken,
        getRequiredScope(req, opts.requiredScopes)
      );
      if (decoded.isErr()) {
        logger.error(decoded.error, "Failed to verify Auth0 token");
        return apiError(req, res, {
          status_code: 401,
          api_error: {
            type: "not_authenticated",
            message:
              "The request does not have valid authentication credentials.",
          },
        });
      }

      const user = await getUserFromAuth0Token(decoded.value);
      // TODO(thomas): user not found : means the user is not registered, display a message to the user and redirects to site
      if (!user) {
        return apiError(req, res, {
          status_code: 401,
          api_error: {
            type: "not_authenticated",
            message:
              "The user does not have an active session or is not authenticated.",
          },
        });
      }

      const userWithWorkspaces = await getUserWithWorkspaces(user);

      return handler(req, res, userWithWorkspaces);
    }
  );
}