import { Message } from '@google-cloud/pubsub';
import { BaseRpcContext } from '@nestjs/microservices/ctx-host/base-rpc.context';

type PubSubContextArgs = [Message, string];

export class PubSubContext extends BaseRpcContext<PubSubContextArgs> {
  constructor(args: PubSubContextArgs) {
    super(args);
  }

  /**
   * Retornna el mensaje original (con propiedades, campos y contenido).
   */
  getMessage() {
    return this.args[0];
  }

  /**
   * Retorna el nombre del patron de suscripcion.
   */
  getPattern() {
    return this.args[1];
  }
}
