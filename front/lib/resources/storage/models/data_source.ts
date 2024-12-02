import type { ConnectorProvider } from "@dust-tt/types";
import type { CreationOptional, ForeignKey, NonAttribute } from "sequelize";
import { DataTypes } from "sequelize";

import { Conversation } from "@app/lib/models/assistant/conversation";
import { User } from "@app/lib/models/user";
import { Workspace } from "@app/lib/models/workspace";
import { frontSequelize } from "@app/lib/resources/storage";
import { SpaceModel } from "@app/lib/resources/storage/models/spaces";
import { SoftDeletableModel } from "@app/lib/resources/storage/wrappers";

export class DataSourceModel extends SoftDeletableModel<DataSourceModel> {
  declare id: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Corresponds to the ID of the last user to configure the connection.
  declare editedByUserId: ForeignKey<User["id"]> | null;
  declare editedAt: Date;

  declare name: string;
  declare description: string | null;
  declare assistantDefaultSelected: boolean;
  declare dustAPIProjectId: string;
  declare dustAPIDataSourceId: string;
  declare connectorId: string | null;
  declare connectorProvider: ConnectorProvider | null;
  declare workspaceId: ForeignKey<Workspace["id"]>;
  declare vaultId: ForeignKey<SpaceModel["id"]>;
  declare conversationId: ForeignKey<Conversation["id"]>;

  declare editedByUser: NonAttribute<User>;
  declare conversation: NonAttribute<Conversation>;
  declare space: NonAttribute<SpaceModel>;
  declare workspace: NonAttribute<Workspace>;
}

DataSourceModel.init(
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
    deletedAt: {
      type: DataTypes.DATE,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    editedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
    },
    assistantDefaultSelected: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    dustAPIProjectId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    dustAPIDataSourceId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    connectorId: {
      type: DataTypes.STRING,
    },
    connectorProvider: {
      type: DataTypes.STRING,
    },
  },
  {
    modelName: "data_source",
    sequelize: frontSequelize,
    indexes: [
      { fields: ["workspaceId", "name", "deletedAt"], unique: true },
      { fields: ["workspaceId", "connectorProvider"] },
      { fields: ["workspaceId", "vaultId"] },
      { fields: ["workspaceId", "conversationId"] },
      { fields: ["dustAPIProjectId"] },
    ],
  }
);
Workspace.hasMany(DataSourceModel, {
  as: "workspace",
  foreignKey: { name: "workspaceId", allowNull: false },
  onDelete: "CASCADE",
});
Conversation.hasMany(DataSourceModel, {
  as: "conversation",
  foreignKey: { name: "conversationId", allowNull: true },
  onDelete: "RESTRICT",
});
DataSourceModel.belongsTo(Workspace, {
  as: "workspace",
  foreignKey: { name: "workspaceId", allowNull: false },
});

DataSourceModel.belongsTo(User, {
  as: "editedByUser",
  foreignKey: { name: "editedByUserId", allowNull: true },
});

DataSourceModel.belongsTo(SpaceModel, {
  foreignKey: { name: "vaultId", allowNull: false },
  onDelete: "RESTRICT",
});
