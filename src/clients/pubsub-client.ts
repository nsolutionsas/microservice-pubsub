import { Logger } from '@nestjs/common';
import {
  ClientProxy,
  IncomingResponse,
  ReadPacket,
  WritePacket,
} from '@nestjs/microservices';
import { ERROR_EVENT, MESSAGE_EVENT } from '@nestjs/microservices/constants';
import {
  ClientConfig,
  Message,
  PubSub,
  PublishOptions,
  SubscriberOptions,
  Subscription,
  Topic,
} from '@google-cloud/pubsub';
import { PubSubOptions } from '../interfaces/pubsub-options.interface';
import {
  ALREADY_EXISTS,
  GC_PUBSUB_DEFAULT_CLIENT_CONFIG,
  GC_PUBSUB_DEFAULT_INIT,
  GC_PUBSUB_DEFAULT_NO_ACK,
  GC_PUBSUB_DEFAULT_PUBLISHER_CONFIG,
  GC_PUBSUB_DEFAULT_SUBSCRIBER_CONFIG,
  GC_PUBSUB_DEFAULT_TOPIC,
} from '../util/pubsub.constants';

export class PubSubClient extends ClientProxy {
  protected readonly logger = new Logger(PubSubClient.name);

  protected readonly topicName: string;
  protected readonly publisherConfig: PublishOptions;
  protected readonly replyTopicName?: string;
  protected readonly replySubscriptionName?: string;
  protected readonly clientConfig: ClientConfig;
  protected readonly subscriberConfig: SubscriberOptions;
  protected readonly noAck: boolean;

  protected client: PubSub | null = null;
  protected replySubscription: Subscription | null = null;
  protected topic: Topic | null = null;
  protected init: boolean;

  constructor(protected readonly options: PubSubOptions) {
    super();

    this.clientConfig = this.options.client || GC_PUBSUB_DEFAULT_CLIENT_CONFIG;
    this.topicName = this.options.topic || GC_PUBSUB_DEFAULT_TOPIC;
    this.subscriberConfig =
      this.options.subscriber || GC_PUBSUB_DEFAULT_SUBSCRIBER_CONFIG;
    this.publisherConfig =
      this.options.publisher || GC_PUBSUB_DEFAULT_PUBLISHER_CONFIG;
    this.replyTopicName = this.options.replyTopic;
    this.replySubscriptionName = this.options.replySubscription;
    this.noAck = this.options.noAck ?? GC_PUBSUB_DEFAULT_NO_ACK;
    this.init = this.options.init ?? GC_PUBSUB_DEFAULT_INIT;

    this.initializeSerializer(options);
    this.initializeDeserializer(options);
  }

  public async close(): Promise<void> {
    if (this.topic) {
      await this.topic.flush();
    }

    if (this.replySubscription) {
      await this.replySubscription.close();
    }

    if (this.client) {
      await this.client.close();
    }

    this.client = null;
    this.topic = null;
    this.replySubscription = null;
  }

  async connect(): Promise<PubSub> {
    if (this.client) return this.client;

    this.client = this.createClient();
    this.topic = this.client.topic(this.topicName, this.publisherConfig);
    const [topicExists] = await this.topic.exists();

    if (!topicExists) {
      const message = `PubSub client no se pudo conectar: El Topic ${this.topicName} no existe`;
      this.logger.error(message);
      throw new Error(message);
    }

    if (this.replyTopicName && this.replySubscriptionName) {
      const replyTopic = this.client.topic(this.replyTopicName);

      if (this.init) {
        await this.createIfNotExists(replyTopic.create.bind(replyTopic));
      } else {
        const [exists] = await replyTopic.exists();
        if (!exists) {
          const message = `PubSub client is not connected: topic ${this.replyTopicName} does not exist`;
          this.logger.error(message);
          throw new Error(message);
        }
      }

      this.replySubscription = replyTopic.subscription(
        this.replySubscriptionName,
        this.subscriberConfig,
      );

      if (this.init) {
        await this.createIfNotExists(
          this.replySubscription.create.bind(this.replySubscription),
        );
      } else {
        const [exists] = await this.replySubscription.exists();
        if (!exists) {
          const message = `PubSub client is not connected: subscription ${this.replySubscription} does not exist`;
          this.logger.error(message);
          throw new Error(message);
        }
      }

      this.replySubscription
        .on(MESSAGE_EVENT, async (message: Message) => {
          await this.handleResponse(message.data);
          if (this.noAck) {
            message.ack();
          }
        })
        .on(ERROR_EVENT, (err: any) => this.logger.error(err));
    }

    return this.client;
  }

  private createClient(): PubSub {
    return new PubSub(this.clientConfig);
  }

  protected async dispatchEvent(packet: ReadPacket): Promise<any> {
    const pattern = this.normalizePattern(packet.pattern);

    const serializedPacket = this.serializer.serialize({
      ...packet,
      pattern,
    });

    if (this.topic) {
      await this.topic.publishMessage({ json: serializedPacket });
    }
  }

  protected publish(
    partialPacket: ReadPacket,
    callback: (packet: WritePacket) => void,
  ) {
    try {
      const packet = this.assignPacketId(partialPacket);

      const serializedPacket = this.serializer.serialize(packet);
      this.routingMap.set(packet.id, callback);

      if (this.topic && this.replyTopicName) {
        this.topic
          .publishMessage({
            json: serializedPacket,
            attributes: { replyTo: this.replyTopicName },
          })
          .catch((err) => callback({ err }));
      } else {
        callback({ err: new Error('Topic is not created') });
      }

      return () => this.routingMap.delete(packet.id);
    } catch (err) {
      this.logger.debug('error en publicar');
      callback({ err });
    }
  }

  public async handleResponse(data: Buffer) {
    const rawMessage = JSON.parse(data.toString());

    const { err, response, isDisposed, id } = this.deserializer.deserialize(
      rawMessage,
    ) as IncomingResponse;
    const callback = this.routingMap.get(id);
    if (!callback) {
      return;
    }

    if (err || isDisposed) {
      return callback({
        err,
        response,
        isDisposed,
      });
    }
    callback({
      err,
      response,
    });
  }

  private async createIfNotExists(create: () => Promise<any>) {
    try {
      await create();
    } catch (error: any) {
      if (error.code !== ALREADY_EXISTS) {
        throw error;
      }
    }
  }
}
