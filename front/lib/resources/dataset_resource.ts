import type { DatasetType, Result } from "@dust-tt/types";
import { Ok } from "@dust-tt/types";
import type {
  Attributes,
  CreationAttributes,
  ModelStatic,
  Transaction,
} from "sequelize";

import type { Authenticator } from "@app/lib/auth";
import type { AppResource } from "@app/lib/resources/app_resource";
import { BaseResource } from "@app/lib/resources/base_resource";
import { Dataset } from "@app/lib/resources/storage/models/apps";
import type { ReadonlyAttributesType } from "@app/lib/resources/storage/types";

// Attributes are marked as read-only to reflect the stateless nature of our Resource.
// This design will be moved up to BaseResource once we transition away from Sequelize.
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-unsafe-declaration-merging
export interface DatasetResource extends ReadonlyAttributesType<Dataset> {}
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class DatasetResource extends BaseResource<Dataset> {
  static model: ModelStatic<Dataset> = Dataset;

  private app: AppResource;

  constructor(
    model: ModelStatic<Dataset>,
    blob: Attributes<Dataset>,
    app: AppResource
  ) {
    super(DatasetResource.model, blob);
    this.app = app;
  }

  static async makeNew(
    blob: Omit<CreationAttributes<Dataset>, "appId">,
    app: AppResource
  ) {
    const dataset = await Dataset.create({
      ...blob,
      appId: app.id,
    });

    return new this(DatasetResource.model, dataset.get(), app);
  }

  // Deletion.

  async delete(
    auth: Authenticator,
    t?: Transaction
  ): Promise<Result<undefined, Error>> {
    await Dataset.destroy({
      where: {
        id: this.id,
        workspaceId: auth.getNonNullableWorkspace().id,
      },
      transaction: t,
    });
    return new Ok(undefined);
  }

  // Serialization.

  toJSON(): DatasetType {
    return {
      name: this.name,
      description: this.description,
      schema: this.schema,
      data: null,
    };
  }
}