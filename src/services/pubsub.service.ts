import { PubSubClient } from '../clients/pubsub-client';
import { PubSubInterface } from '../interfaces/pubsub.interface';

export class PubSubService {
  client: PubSubClient;
  setting: PubSubInterface;

  constructor(setting: PubSubInterface) {
    this.setting = setting;
  }

  public async send(pattern: string, data: any) {
    await this.initClient();

    return this.client.send(pattern, data).subscribe(() => {
      this.close();
    });
  }

  private async initClient() {
    this.client = await new PubSubClient({
      topic: this.setting.topic,
      subscription: this.setting.subscription,
      replyTopic: this.setting.replyTopic,
      replySubscription: this.setting.replySubscription,
      noAck: this.setting.noAck,
      client: {
        projectId: this.setting.client.projectId,
        credentials: {
          private_key: this.setting.client.credentials.private_key,
          client_email: this.setting.client.credentials.client_email,
        },
      },
    });
  }

  private async close() {
    this.client.close();
  }
}
