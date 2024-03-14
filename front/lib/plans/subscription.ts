import type { WorkspaceType } from "@dust-tt/types";
import type {
  PlanInvitationType,
  PlanType,
  SubscriptionType,
} from "@dust-tt/types";
import { v4 as uuidv4 } from "uuid";

import type { Authenticator } from "@app/lib/auth";
import { front_sequelize } from "@app/lib/databases";
import { Plan, Subscription, Workspace } from "@app/lib/models";
import { PlanInvitation } from "@app/lib/models/plan";
import type { PlanAttributes } from "@app/lib/plans/free_plans";
import { FREE_NO_PLAN_DATA } from "@app/lib/plans/free_plans";
import {
  FREE_TEST_PLAN_CODE,
  FREE_UPGRADED_PLAN_CODE,
  PRO_PLAN_SEAT_29_CODE,
} from "@app/lib/plans/plan_codes";
import {
  createCheckoutSession,
  getStripeSubscription,
  updateStripeSubscriptionQuantity,
  updateStripeSubscriptionUsage,
} from "@app/lib/plans/stripe";
import {
  countActiveSeatsInWorkspace,
  countActiveUsersInWorkspaceSince,
} from "@app/lib/plans/workspace_usage";
import { redisClient } from "@app/lib/redis";
import { generateModelSId } from "@app/lib/utils";
import logger from "@app/logger/logger";

// Helper function to render PlanType from PlanAttributes
export function renderPlanFromModel({
  plan,
}: {
  plan: PlanAttributes;
}): PlanType {
  return {
    code: plan.code,
    name: plan.name,
    stripeProductId: plan.stripeProductId,
    billingType: plan.billingType,
    limits: {
      assistant: {
        isSlackBotAllowed: plan.isSlackbotAllowed,
        maxMessages: plan.maxMessages,
      },
      connections: {
        isConfluenceAllowed: plan.isManagedConfluenceAllowed,
        isSlackAllowed: plan.isManagedSlackAllowed,
        isNotionAllowed: plan.isManagedNotionAllowed,
        isGoogleDriveAllowed: plan.isManagedGoogleDriveAllowed,
        isGithubAllowed: plan.isManagedGithubAllowed,
        isIntercomAllowed: plan.isManagedIntercomAllowed,
        isWebCrawlerAllowed: plan.isManagedWebCrawlerAllowed,
      },
      dataSources: {
        count: plan.maxDataSourcesCount,
        documents: {
          count: plan.maxDataSourcesDocumentsCount,
          sizeMb: plan.maxDataSourcesDocumentsSizeMb,
        },
      },
      users: {
        maxUsers: plan.maxUsersInWorkspace,
      },
      canUseProduct: plan.canUseProduct,
    },
    trialPeriodDays: plan.trialPeriodDays,
  };
}

// Helper in charge of rendering the SubscriptionType object form PlanAttributes and optionally an
// active Subscription model.
export function renderSubscriptionFromModels({
  plan,
  activeSubscription,
}: {
  plan: PlanAttributes;
  activeSubscription: Subscription | null;
}): SubscriptionType {
  return {
    status: activeSubscription?.status ?? "active",
    sId: activeSubscription?.sId || null,
    stripeSubscriptionId: activeSubscription?.stripeSubscriptionId || null,
    stripeCustomerId: activeSubscription?.stripeCustomerId || null,
    startDate: activeSubscription?.startDate?.getTime() || null,
    endDate: activeSubscription?.endDate?.getTime() || null,
    paymentFailingSince:
      activeSubscription?.paymentFailingSince?.getTime() || null,
    plan: renderPlanFromModel({ plan }),
  };
}

/**
 * Internal function to subscribe to the FREE_NO_PLAN.
 * This is the only plan without a database entry: no need to create a subscription, we just end the active one if any.
 */
export const internalSubscribeWorkspaceToFreeNoPlan = async ({
  workspaceId,
}: {
  workspaceId: string;
}): Promise<SubscriptionType> => {
  const workspace = await Workspace.findOne({
    where: { sId: workspaceId },
  });
  if (!workspace) {
    throw new Error(`Cannot find workspace ${workspaceId}`);
  }
  const now = new Date();

  return front_sequelize.transaction(async (t) => {
    // We end the active subscription if any
    const activeSubscription = await Subscription.findOne({
      where: { workspaceId: workspace.id, status: "active" },
      transaction: t,
    });

    if (activeSubscription) {
      await activeSubscription.update(
        {
          status: "ended",
          endDate: now,
        },
        { transaction: t }
      );
    }

    const plan: PlanAttributes = FREE_NO_PLAN_DATA;

    return renderSubscriptionFromModels({
      plan,
      // No active subscription for FREE_NO_PLAN
      activeSubscription: null,
    });
  });
};

/**
 * Internal function to subscribe to the FREE_TEST_PLAN.
 */
export const internalSubscribeWorkspaceToFreeTestPlan = async ({
  workspaceId,
}: {
  workspaceId: string;
}): Promise<SubscriptionType> => {
  const workspace = await Workspace.findOne({
    where: { sId: workspaceId },
  });
  if (!workspace) {
    throw new Error(`Cannot find workspace ${workspaceId}`);
  }
  const plan = await Plan.findOne({
    where: { code: FREE_TEST_PLAN_CODE },
  });
  if (!plan) {
    throw new Error(
      `Cannot subscribe to plan ${FREE_TEST_PLAN_CODE}:  not found.`
    );
  }

  const now = new Date();

  return front_sequelize.transaction(async (t) => {
    // We end the active subscription if any
    const activeSubscription = await Subscription.findOne({
      where: { workspaceId: workspace.id, status: "active" },
      transaction: t,
    });

    if (activeSubscription) {
      await activeSubscription.update(
        {
          status: "ended",
          endDate: now,
        },
        { transaction: t }
      );
    }

    // We create a new subscription
    const newSubscription = await Subscription.create(
      {
        sId: generateModelSId(),
        workspaceId: workspace.id,
        planId: plan.id,
        status: "active",
        startDate: now,
        stripeCustomerId: activeSubscription?.stripeCustomerId || null,
      },
      { transaction: t }
    );

    return renderSubscriptionFromModels({
      plan,
      activeSubscription: newSubscription,
    });
  });
};

/**
 * Internal function to subscribe to the FREE_UPGRADED_PLAN.
 * This plan is free with no limitations, and should be used for Dust workspaces only (once we have paiement plans)
 */
export const internalSubscribeWorkspaceToFreeUpgradedPlan = async ({
  workspaceId,
  planCode = FREE_UPGRADED_PLAN_CODE,
}: {
  workspaceId: string;
  planCode?: string;
}): Promise<SubscriptionType> => {
  const workspace = await Workspace.findOne({
    where: { sId: workspaceId },
  });
  if (!workspace) {
    throw new Error(`Cannot find workspace ${workspaceId}`);
  }
  const plan = await Plan.findOne({
    where: { code: planCode },
  });
  if (!plan) {
    throw new Error(`Cannot subscribe to plan ${planCode}:  not found.`);
  }

  const now = new Date();

  // We search for an active subscription for this workspace
  const activeSubscription = await Subscription.findOne({
    where: { workspaceId: workspace.id, status: "active" },
  });
  if (activeSubscription && activeSubscription.planId === plan.id) {
    throw new Error(
      `Cannot subscribe to plan ${planCode}: already subscribed.`
    );
  }

  return front_sequelize.transaction(async (t) => {
    // We end the active subscription if any
    if (activeSubscription) {
      await activeSubscription.update(
        {
          status: "ended",
          endDate: now,
        },
        { transaction: t }
      );
    }

    // We create a new subscription
    const newSubscription = await Subscription.create(
      {
        sId: generateModelSId(),
        workspaceId: workspace.id,
        planId: plan.id,
        status: "active",
        startDate: now,
        stripeCustomerId: activeSubscription?.stripeCustomerId || null,
      },
      { transaction: t }
    );

    return renderSubscriptionFromModels({
      plan,
      activeSubscription: newSubscription,
    });
  });
};

/**
 * Internal function to create a PlanInvitation for the workspace.
 */
export const pokeUpgradeOrInviteWorkspaceToPlan = async (
  auth: Authenticator,
  planCode: string
): Promise<PlanInvitationType | void> => {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error("Cannot find workspace}");
  }

  if (!auth.isDustSuperUser()) {
    throw new Error("Cannot invite workspace to enterprise plan: not allowed.");
  }

  const plan = await Plan.findOne({
    where: { code: planCode },
  });
  if (!plan) {
    throw new Error(
      `Cannot invite workspace to plan ${planCode}: plan not found.`
    );
  }

  // We search for an active subscription for this workspace
  const activeSubscription = auth.subscription();
  if (activeSubscription && activeSubscription.plan.code === plan.code) {
    throw new Error(
      `Cannot subscribe to plan ${planCode}: already subscribed.`
    );
  }

  // If plan is a free plan, we subscribe immediately no need for an invitation
  if (plan.billingType === "free" && plan.stripeProductId === null) {
    await internalSubscribeWorkspaceToFreeUpgradedPlan({
      workspaceId: owner.sId,
      planCode: plan.code,
    });
    return;
  }

  const invitation = await getPlanInvitation(auth);
  if (invitation?.planCode === plan.code) {
    return invitation;
  }

  const model = await front_sequelize.transaction(async (t) => {
    if (invitation) {
      await PlanInvitation.destroy({
        where: { workspaceId: owner.id, consumedAt: null },
        transaction: t,
      });
    }

    return PlanInvitation.create(
      {
        secret: uuidv4(),
        workspaceId: owner.id,
        planId: plan.id,
      },
      {
        transaction: t,
      }
    );
  });

  return {
    planCode: plan.code,
    planName: plan.name,
    secret: model.secret,
  };
};

// Returns the Stripe checkout URL for the plan the workspace can upgrade to.
// The plan can either be the "PRO_PLAN_SEAT_29_CODE" (aka the pro plan), or
// the enterprise plan the workspace has been invited to.
export const getCheckoutUrlForUpgrade = async (
  auth: Authenticator
): Promise<{ checkoutUrl: string; plan: PlanType }> => {
  const owner = auth.workspace();

  if (!owner) {
    throw new Error(
      "Unauthorized `auth` data: cannot process to subscription of new Plan."
    );
  }

  const planInvitation = await getPlanInvitation(auth);

  const planCode = planInvitation?.planCode ?? PRO_PLAN_SEAT_29_CODE;

  const plan = await Plan.findOne({
    where: { code: planCode },
  });

  if (!plan) {
    throw new Error(`Cannot subscribe to plan ${planCode}: not found.`);
  }
  if (!plan.stripeProductId) {
    throw new Error(
      `Cannot subscribe to plan ${planCode}: no Stripe Product ID.`
    );
  }
  if (plan.billingType === "free") {
    throw new Error(
      `Cannot subscribe to plan ${planCode}: billingType is "free".`
    );
  }

  const existingSubscription = auth.subscription();
  if (existingSubscription && existingSubscription.plan.code === plan.code) {
    throw new Error(
      `Cannot subscribe to pro plan ${planCode}: already subscribed.`
    );
  }

  // We enter Stripe Checkout flow
  const checkoutUrl = await createCheckoutSession({
    auth,
    planCode: plan.code,
  });

  if (!checkoutUrl) {
    throw new Error(
      `Cannot subscribe to plan ${planCode}: error while creating Stripe Checkout session (URL is null).`
    );
  }

  return {
    checkoutUrl,
    plan: renderPlanFromModel({ plan }),
  };
};

export const downgradeWorkspaceToFreePlan = async (
  auth: Authenticator
): Promise<PlanType> => {
  const user = auth.user();
  const owner = auth.workspace();
  const activePlan = auth.plan();

  if (!user || !auth.isAdmin() || !owner || !activePlan) {
    throw new Error(
      "Unauthorized `auth` data: cannot process to subscription of new Plan."
    );
  }

  const freeTestPlan = await Plan.findOne({
    where: { code: FREE_TEST_PLAN_CODE },
  });
  if (!freeTestPlan) {
    throw new Error(
      `Cannot downgrade to free plan ${FREE_TEST_PLAN_CODE}: not found.`
    );
  }
  if (freeTestPlan.stripeProductId) {
    throw new Error(
      `Cannot downgrade to free plan ${FREE_TEST_PLAN_CODE}: has a Stripe Product ID.`
    );
  }
  if (freeTestPlan.billingType !== "free") {
    throw new Error(
      `Cannot downgrade to free plan ${FREE_TEST_PLAN_CODE}: billingType is not "free".`
    );
  }

  const existingSubscription = auth.subscription();
  if (
    existingSubscription &&
    existingSubscription.plan.code === freeTestPlan.code
  ) {
    throw new Error(
      `Cannot downgrade to free plan ${FREE_TEST_PLAN_CODE}: already subscribed.`
    );
  }

  const sub = await internalSubscribeWorkspaceToFreeTestPlan({
    workspaceId: owner.sId,
  });

  return sub.plan;
};

export const updateWorkspacePerSeatSubscriptionUsage = async ({
  workspaceId,
}: {
  workspaceId: string;
}): Promise<void> => {
  try {
    const workspace = await Workspace.findOne({
      where: { sId: workspaceId },
    });
    if (!workspace) {
      throw new Error(
        "Cannot process update usage in subscription: workspace not found."
      );
    }

    const activeSubscription = await Subscription.findOne({
      where: { workspaceId: workspace.id, status: "active" },
      include: [
        {
          model: Plan,
          as: "plan",
          required: true,
        },
      ],
    });

    if (!activeSubscription) {
      throw new Error(
        "Cannot process update usage in subscription: workspace has no subscription."
      );
    }

    if (activeSubscription.plan.billingType !== "per_seat") {
      // We only update the usage for plans with billingType === "per_seat"
      return;
    }
    if (
      !activeSubscription.stripeSubscriptionId ||
      !activeSubscription.stripeCustomerId ||
      !activeSubscription.plan.stripeProductId
    ) {
      throw new Error(
        "Cannot update usage in per_seat subscription: missing Stripe subscription ID or Stripe customer ID."
      );
    }

    // We update the subscription usage
    const activeSeats = await countActiveSeatsInWorkspace(workspace.sId);

    await updateStripeSubscriptionQuantity({
      stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
      stripeProductId: activeSubscription.plan.stripeProductId,
      quantity: activeSeats,
    });
  } catch (err) {
    logger.warn(
      `Error while updating Stripe subscription quantity for workspace ${workspaceId}: ${err}`
    );
  }
};

export const updateWorkspacePerMonthlyActiveUsersSubscriptionUsage = async ({
  owner,
  subscription,
}: {
  owner: WorkspaceType;
  subscription: SubscriptionType;
}): Promise<void> => {
  let redis = null;
  try {
    redis = await redisClient();
    if (subscription.plan.billingType !== "monthly_active_users") {
      // We only update the usage for plans with billingType === "monthly_active_users"
      return;
    }
    if (
      !subscription.stripeSubscriptionId ||
      !subscription.stripeCustomerId ||
      !subscription.plan.stripeProductId
    ) {
      throw new Error(
        "Cannot update usage in monthly_active_users subscription: missing Stripe subscription ID or Stripe customer ID."
      );
    }

    const redisKey = `workspace:usage:${owner.sId}`;
    const usageForWorkspace = await redis.get(redisKey);
    if (usageForWorkspace) {
      // If already reported usage for this workspace in the last hour we do nothing
      return;
    }

    const stripeSubscription = await getStripeSubscription(
      subscription.stripeSubscriptionId
    );

    if (!stripeSubscription) {
      throw new Error(
        `Cannot update usage in monthly_active_users subscription: Stripe subscription ${subscription.stripeSubscriptionId} not found.`
      );
    }
    const quantity = await countActiveUsersInWorkspaceSince({
      workspace: owner,
      since: new Date(stripeSubscription.current_period_start * 1000),
    });
    await updateStripeSubscriptionUsage({
      stripeSubscription,
      quantity,
    });

    // We store the usage in Redis to update Stripe only once per hour if mutliple messages are sent
    await redis.set(redisKey, quantity, {
      EX: 3600, // 1 hour
    });
  } catch (err) {
    logger.error(
      `Error while updating Stripe subscription usage for workspace ${owner.sId}: ${err}`
    );
  } finally {
    if (redis) {
      await redis.quit();
    }
  }
};

export async function getPlanInvitation(
  auth: Authenticator
): Promise<PlanInvitationType | null> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error("Cannot find workspace");
  }

  const planInvitations = await PlanInvitation.findAll({
    where: { workspaceId: owner.id, consumedAt: null },
    include: [
      {
        model: Plan,
        as: "plan",
        required: true,
      },
    ],
  });

  if (planInvitations.length > 1) {
    logger.warn(
      "unreachable: there should be at most one pending invitation per workspace"
    );
  }

  if (!planInvitations.length) {
    return null;
  }

  return {
    planCode: planInvitations[0].plan.code,
    planName: planInvitations[0].plan.name,
    secret: planInvitations[0].secret,
  };
}
