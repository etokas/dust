import type { SpaceKind } from "@dust-tt/types";
import type { CreationOptional, ForeignKey, NonAttribute } from "sequelize";
import { DataTypes } from "sequelize";

import { Workspace } from "@app/lib/models/workspace";
import { frontSequelize } from "@app/lib/resources/storage";
import type { GroupModel } from "@app/lib/resources/storage/models/groups";
import { SoftDeletableModel } from "@app/lib/resources/storage/wrappers";

export class SpaceModel extends SoftDeletableModel<SpaceModel> {
  declare id: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare name: string;
  declare kind: SpaceKind;

  declare workspaceId: ForeignKey<Workspace["id"]>;
  declare groups: NonAttribute<GroupModel[]>;
}
SpaceModel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    deletedAt: {
      type: DataTypes.DATE,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    kind: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    modelName: "spaces",
    tableName: "vaults",
    sequelize: frontSequelize,
    indexes: [
      { unique: true, fields: ["workspaceId", "name", "deletedAt"] },
      { unique: false, fields: ["workspaceId", "kind"] },
    ],
  }
);

Workspace.hasMany(SpaceModel, {
  foreignKey: { allowNull: false },
  onDelete: "RESTRICT",
});
SpaceModel.belongsTo(Workspace, {
  foreignKey: { allowNull: false },
  onDelete: "RESTRICT",
});