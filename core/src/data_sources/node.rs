use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq, Deserialize, Copy)]
pub enum NodeType {
    Document,
    Table,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    data_source_id: String,
    node_id: String,
    node_type: NodeType,
    timestamp: u64,
    title: String,
    mime_type: String,
    parents: Vec<String>,
}

impl Node {
    pub fn new(
        data_source_id: &str,
        node_id: &str,
        node_type: NodeType,
        timestamp: u64,
        title: &str,
        mime_type: &str,
        parents: Vec<String>,
    ) -> Self {
        Node {
            data_source_id: data_source_id.to_string(),
            node_id: node_id.to_string(),
            node_type,
            timestamp,
            title: title.to_string(),
            mime_type: mime_type.to_string(),
            parents,
        }
    }

    pub fn data_source_id(&self) -> &str {
        &self.data_source_id
    }
    pub fn timestamp(&self) -> u64 {
        self.timestamp
    }
    pub fn node_id(&self) -> &str {
        &self.node_id
    }
    pub fn node_type(&self) -> NodeType {
        self.node_type
    }
    pub fn title(&self) -> &str {
        &self.title
    }
    pub fn mime_type(&self) -> &str {
        &self.mime_type
    }
    pub fn parents(&self) -> &Vec<String> {
        &self.parents
    }
}
