interface Credential {
  private_key: string;
  client_email: string;
}

interface Client {
  projectId: string;
  credentials: Credential;
}

export interface PubSubInterface {
  topic: string;
  subscription: string;
  replyTopic: string;
  replySubscription: string;
  noAck: boolean;
  client: Client;
}
