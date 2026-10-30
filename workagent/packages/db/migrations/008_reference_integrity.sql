ALTER TABLE document ADD UNIQUE(space_id,id);
ALTER TABLE chunk ADD FOREIGN KEY(space_id,document_id) REFERENCES document(space_id,id) ON DELETE CASCADE;
ALTER TABLE agent ADD FOREIGN KEY(id,current_revision_id) REFERENCES agent_revision(agent_id,id);
ALTER TABLE conversation ADD FOREIGN KEY(org_id,agent_id) REFERENCES agent(org_id,id);
ALTER TABLE conversation ADD FOREIGN KEY(org_id,user_id) REFERENCES membership(org_id,user_id);
ALTER TABLE channel_conversation ADD FOREIGN KEY(org_id,account_id) REFERENCES channel_account(org_id,id);
ALTER TABLE channel_conversation ADD FOREIGN KEY(org_id,agent_id) REFERENCES agent(org_id,id);
ALTER TABLE channel_conversation ADD FOREIGN KEY(org_id,conversation_id) REFERENCES conversation(org_id,id);
