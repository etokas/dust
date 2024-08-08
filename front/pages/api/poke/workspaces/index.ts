import type {
  LightWorkspaceType,
  MembershipRoleType,
  SubscriptionType,
  WithAPIErrorResponse,
  WorkspaceDomain,
} from "@dust-tt/types";
import type { NextApiRequest, NextApiResponse } from "next";
import type { FindOptions, Order, WhereOptions } from "sequelize";
import { Op } from "sequelize";

import { getWorkspaceVerifiedDomain } from "@app/lib/api/workspace";
import { withSessionAuthentication } from "@app/lib/api/wrappers";
import { Authenticator, getSession } from "@app/lib/auth";
import { Plan, Subscription } from "@app/lib/models/plan";
import { Workspace, WorkspaceHasDomain } from "@app/lib/models/workspace";
import {
  FREE_TEST_PLAN_CODE,
  isEntreprisePlan,
  isFreePlan,
  isFriendsAndFamilyPlan,
  isOldFreePlan,
  isProPlan,
} from "@app/lib/plans/plan_codes";
import { renderSubscriptionFromModels } from "@app/lib/plans/subscription";
import { DataSourceResource } from "@app/lib/resources/data_source_resource";
import { MembershipResource } from "@app/lib/resources/membership_resource";
import { UserResource } from "@app/lib/resources/user_resource";
import { isDomain, isEmailValid } from "@app/lib/utils";
import { apiError } from "@app/logger/withlogging";

export type PokeWorkspaceType = LightWorkspaceType & {
  createdAt: string;
  upgradedAt: string | null;
  subscription: SubscriptionType;
  adminEmail: string | null;
  membersCount: number;
  dataSourcesCount: number;
  workspaceDomain: WorkspaceDomain | null;
};

export type GetPokeWorkspacesResponseBody = {
  workspaces: PokeWorkspaceType[];
};

const getPlanPriority = (planCode: string) => {
  if (isEntreprisePlan(planCode)) {
    return 1;
  }

  if (isFriendsAndFamilyPlan(planCode)) {
    return 2;
  }

  if (isProPlan(planCode)) {
    return 3;
  }

  if (isFreePlan(planCode)) {
    return 4;
  }

  if (isOldFreePlan(planCode)) {
    return 5;
  }

  return 6;
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WithAPIErrorResponse<GetPokeWorkspacesResponseBody>>
): Promise<void> {
  const session = await getSession(req, res);
  const auth = await Authenticator.fromSuperUserSession(session, null);

  if (!auth.isDustSuperUser()) {
    return apiError(req, res, {
      status_code: 404,
      api_error: {
        type: "user_not_found",
        message: "Could not find the user.",
      },
    });
  }

  switch (req.method) {
    case "GET":
      let listUpgraded: boolean | undefined;
      const searchTerm = req.query.search
        ? decodeURIComponent(req.query.search as string).trim()
        : undefined;
      let limit: number = 0;
      let originalLimit: number = 0;
      const order: Order = [["createdAt", "DESC"]];

      if (req.query.upgraded !== undefined) {
        if (
          typeof req.query.upgraded !== "string" ||
          !["true", "false"].includes(req.query.upgraded)
        ) {
          return apiError(req, res, {
            status_code: 400,
            api_error: {
              type: "invalid_request_error",
              message:
                "The request query is invalid, expects { upgraded: boolean }.",
            },
          });
        }

        listUpgraded = req.query.upgraded === "true";
      }

      if (searchTerm !== undefined && typeof searchTerm !== "string") {
        return apiError(req, res, {
          status_code: 400,
          api_error: {
            type: "invalid_request_error",
            message:
              "The request query is invalid, expects { search: string }.",
          },
        });
      }

      if (req.query.limit !== undefined) {
        if (
          typeof req.query.limit !== "string" ||
          !/^\d+$/.test(req.query.limit)
        ) {
          return apiError(req, res, {
            status_code: 400,
            api_error: {
              type: "invalid_request_error",
              message:
                "The request query is invalid, expects { limit: number }.",
            },
          });
        }

        originalLimit = parseInt(req.query.limit, 10);
        limit = originalLimit;
      }

      const conditions: WhereOptions<Workspace>[] = [];

      if (listUpgraded !== undefined) {
        const subscriptions = await Subscription.findAll({
          where: {
            status: "active",
          },
          attributes: ["workspaceId"],
          include: [
            {
              model: Plan,
              as: "plan",
              where: {
                code: { [Op.ne]: FREE_TEST_PLAN_CODE },
              },
            },
          ],
        });
        const workspaceIds = subscriptions.map((s) => s.workspaceId);
        if (listUpgraded) {
          conditions.push({
            id: {
              [Op.in]: workspaceIds,
            },
          });
        } else {
          conditions.push({
            id: {
              [Op.notIn]: workspaceIds,
            },
          });
        }
      }

      if (searchTerm) {
        let isSearchByEmail = false;
        if (isEmailValid(searchTerm)) {
          // We can have 2 users with the same email if a Google user and a Github user have the same email.
          const users = await UserResource.listByEmail(searchTerm);
          if (users.length) {
            const memberships = await MembershipResource.getLatestMemberships({
              users,
            });
            if (memberships.length) {
              conditions.push({
                id: {
                  [Op.in]: memberships.map((m) => m.workspaceId),
                },
              });
              isSearchByEmail = true;
            }
          }
        }

        let isSearchByDomain = false;
        if (isDomain(searchTerm)) {
          const workspaceDomain = await WorkspaceHasDomain.findOne({
            where: { domain: searchTerm },
          });

          if (workspaceDomain) {
            isSearchByDomain = true;
            conditions.push({
              id: workspaceDomain.workspaceId,
            });
          }
        }

        if (!isSearchByEmail && !isSearchByDomain) {
          conditions.push({
            [Op.or]: [
              {
                sId: {
                  [Op.iLike]: `${searchTerm}%`,
                },
              },
              {
                name: {
                  [Op.iLike]: `${searchTerm}%`,
                },
              },
            ],
          });
        }

        // In case of search, we increase the limit for the sql query to 100 because we'll sort manually (until a better solution is found).
        // Note from seb: I tried ordering directly in the query but I stumbled into sequelize behaviors that I don't understand.
        limit = 100;
      }

      const where: FindOptions<Workspace>["where"] = conditions.length
        ? {
            [Op.and]: conditions,
          }
        : {};

      const workspaces = await Workspace.findAll({
        where,
        limit,
        include: [
          {
            model: Subscription,
            as: "subscriptions",
            where: { status: "active" },
            required: true,
            include: [
              {
                model: Plan,
                as: "plan",
              },
            ],
          },
        ],
        order: order,
      });

      // if limit is above originalLimit, sort manually and then splice
      if (limit > originalLimit) {
        // Order by plan, entreprise first, then pro, then free and old free using isEntreprisePlan, isProPlan and isFreePlan, isOldFreePlan methods
        workspaces.sort((a, b) => {
          const planAPriority = getPlanPriority(a.subscriptions[0].plan.code);
          const planBPriority = getPlanPriority(b.subscriptions[0].plan.code);

          return planAPriority - planBPriority;
        });

        workspaces.splice(originalLimit);
      }

      return res.status(200).json({
        workspaces: await Promise.all(
          workspaces.map(async (ws): Promise<PokeWorkspaceType> => {
            const subscription: SubscriptionType = renderSubscriptionFromModels(
              {
                plan: ws.subscriptions[0].plan,
                activeSubscription: ws.subscriptions[0],
              }
            );

            const lightWorkspace: LightWorkspaceType = {
              id: ws.id,
              sId: ws.sId,
              name: ws.name,
              role: "admin" as const, // Explicitly type this as "admin"
              segmentation: ws.segmentation,
              whiteListedProviders: ws.whiteListedProviders,
              defaultEmbeddingProvider: ws.defaultEmbeddingProvider,
            };

            const auth = await Authenticator.internalBuilderForWorkspace(
              ws.sId
            );
            const dataSources = await DataSourceResource.listByWorkspace(auth);
            const dataSourcesCount = dataSources.length;

            const admins = await MembershipResource.getActiveMemberships({
              workspace: lightWorkspace,
              roles: ["admin" as MembershipRoleType],
            });

            const firstAdmin = admins.length
              ? await UserResource.fetchByModelId(
                  admins.sort(
                    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
                  )[0].userId
                )
              : null;

            const membersCount =
              await MembershipResource.getMembersCountForWorkspace({
                workspace: lightWorkspace,
                activeOnly: true,
              });

            const verifiedDomain =
              await getWorkspaceVerifiedDomain(lightWorkspace);

            return {
              ...lightWorkspace,
              createdAt: ws.createdAt.toISOString(),
              upgradedAt: ws.upgradedAt?.toISOString() ?? null,
              subscription,
              adminEmail: firstAdmin?.email ?? null,
              membersCount,
              dataSourcesCount,
              workspaceDomain: verifiedDomain,
            };
          })
        ),
      });

    default:
      return apiError(req, res, {
        status_code: 405,
        api_error: {
          type: "method_not_supported_error",
          message: "The method passed is not supported, GET is expected.",
        },
      });
  }
}

export default withSessionAuthentication(handler);
