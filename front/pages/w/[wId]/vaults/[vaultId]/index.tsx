import { Chip, InformationCircleIcon, Page } from "@dust-tt/sparkle";
import type { InferGetServerSidePropsType } from "next";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";

import { CreateOrEditVaultModal } from "@app/components/vaults/CreateOrEditVaultModal";
import { VaultCategoriesList } from "@app/components/vaults/VaultCategoriesList";
import type { VaultLayoutProps } from "@app/components/vaults/VaultLayout";
import { VaultLayout } from "@app/components/vaults/VaultLayout";
import config from "@app/lib/api/config";
import { withDefaultUserAuthRequirements } from "@app/lib/iam/session";
import { VaultResource } from "@app/lib/resources/vault_resource";
import { useVaultInfo } from "@app/lib/swr/vaults";
import { getVaultIcon, getVaultName } from "@app/lib/vaults";

export const getServerSideProps = withDefaultUserAuthRequirements<
  VaultLayoutProps & { userId?: string }
>(async (context, auth) => {
  const owner = auth.getNonNullableWorkspace();
  const subscription = auth.subscription();

  if (!subscription) {
    return {
      notFound: true,
    };
  }

  const vault = await VaultResource.fetchById(
    auth,
    context.query.vaultId as string
  );
  if (!vault) {
    return {
      notFound: true,
    };
  }
  // No root page for System vaults since it contains only managed data sources.
  if (vault.isSystem()) {
    return {
      redirect: {
        destination: `/w/${owner.sId}/vaults/${vault.sId}/categories/managed`,
        permanent: false,
      },
    };
  }

  const isAdmin = auth.isAdmin();

  return {
    props: {
      gaTrackingId: config.getGaTrackingId(),
      isAdmin,
      owner,
      subscription,
      vault: vault.toJSON(),
      userId: auth.user()?.sId,
    },
  };
});

export default function Vault({
  owner,
  vault,
  userId,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const { vaultInfo } = useVaultInfo({
    workspaceId: owner.sId,
    vaultId: vault.sId,
  });

  const router = useRouter();
  const [showVaultEditionModal, setShowVaultEditionModal] = useState(false);
  const isMember = useMemo(
    () => vaultInfo?.members?.some((m) => m.sId === userId),
    [userId, vaultInfo?.members]
  );

  return (
    <Page.Vertical gap="xl" align="stretch">
      <Page.Header title={getVaultName(vault)} icon={getVaultIcon(vault)} />
      {vaultInfo && !isMember && (
        <Chip
          color="warning"
          label="You are not a member of this vault."
          size="sm"
          icon={InformationCircleIcon}
        />
      )}
      <VaultCategoriesList
        owner={owner}
        vault={vault}
        onSelect={(category) => {
          void router.push(
            `/w/${owner.sId}/vaults/${vault.sId}/categories/${category}`
          );
        }}
        onButtonClick={() => setShowVaultEditionModal(true)}
      />
      <CreateOrEditVaultModal
        owner={owner}
        isOpen={showVaultEditionModal}
        onClose={() => setShowVaultEditionModal(false)}
        vault={vault}
      />
    </Page.Vertical>
  );
}

Vault.getLayout = (page: ReactElement, pageProps: any) => {
  return <VaultLayout pageProps={pageProps}>{page}</VaultLayout>;
};