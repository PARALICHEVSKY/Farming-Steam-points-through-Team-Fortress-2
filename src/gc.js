// Tiny TF2 Game Coordinator client: just enough to talk to the Mann Co. Store.
import { EventEmitter } from 'node:events';
import protobuf from 'protobufjs';
import { log } from './util.js';

export const TF2_APPID = 440;

export const Msg = {
  ClientWelcome: 4004,
  ClientHello: 4006,
  StorePurchaseQueryTxn: 2508,
  StorePurchaseQueryTxnResponse: 2509,
  StorePurchaseInit: 2510,
  StorePurchaseInitResponse: 2511,
  StorePurchaseFinalize: 2512,
  StorePurchaseFinalizeResponse: 2513,
  StorePurchaseCancel: 2514,
  StorePurchaseCancelResponse: 2515,
};

const PROTO = `
syntax = "proto2";
message CMsgClientHello { optional uint32 version = 1; }
message CGCStorePurchaseInit_LineItem {
  optional uint32 item_def_id = 1;
  optional uint32 quantity = 2;
  optional uint32 cost_in_local_currency = 3;
  optional uint32 purchase_type = 4;
}
message CMsgGCStorePurchaseInit {
  optional string country = 1;
  optional int32 language = 2;
  optional int32 currency = 3;
  repeated CGCStorePurchaseInit_LineItem line_items = 4;
}
message CMsgGCStorePurchaseInitResponse {
  optional int32 result = 1;
  optional uint64 txn_id = 2;
  optional string url = 3;
  repeated uint64 item_ids = 4;
}
message CMsgGCStorePurchaseFinalize { optional uint64 txn_id = 1; }
message CMsgGCStorePurchaseFinalizeResponse {
  optional uint32 result = 1;
  repeated uint64 item_ids = 2;
}
message CMsgGCStorePurchaseCancel { optional uint64 txn_id = 1; }
message CMsgGCStorePurchaseCancelResponse { optional uint32 result = 1; }
`;

const root = protobuf.parse(PROTO, { keepCase: true }).root;

export function encode(typeName, obj) {
  const T = root.lookupType(typeName);
  return Buffer.from(T.encode(T.fromObject(obj)).finish());
}

export function decode(typeName, buf) {
  const T = root.lookupType(typeName);
  return T.toObject(T.decode(buf), { longs: String, defaults: true, arrays: true });
}

export class TF2GC extends EventEmitter {
  constructor(user) {
    super();
    this.user = user;
    this.connected = false;
    user.on('receivedFromGC', (appid, msgType, payload) => {
      if (appid !== TF2_APPID) return;
      if (msgType === Msg.ClientWelcome) {
        if (!this.connected) log('Подключились к координатору TF2');
        this.connected = true;
        this.emit('welcome');
      }
      this.emit('message', msgType, payload);
    });
  }

  async connect(timeoutMs = 90_000) {
    if (this.connected) return;
    this.user.gamesPlayed([TF2_APPID], true);
    const hello = () => this.user.sendToGC(TF2_APPID, Msg.ClientHello, {}, encode('CMsgClientHello', {}));
    const timer = setInterval(hello, 5000);
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Координатор TF2 не ответил')), timeoutMs);
        this.once('welcome', () => { clearTimeout(t); resolve(); });
        hello();
      });
    } finally {
      clearInterval(timer);
    }
  }

  send(msgType, typeName, obj) {
    this.user.sendToGC(TF2_APPID, msgType, {}, encode(typeName, obj));
  }

  /** Sends a message and waits for the first GC reply of the given type. */
  request(msgType, typeName, obj, respType, respTypeName, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const onMsg = (type, payload) => {
        if (type !== respType) return;
        cleanup();
        try { resolve(decode(respTypeName, payload)); } catch (e) { reject(e); }
      };
      const t = setTimeout(() => { cleanup(); reject(new Error(`Нет ответа GC на сообщение ${msgType}`)); }, timeoutMs);
      const cleanup = () => { clearTimeout(t); this.removeListener('message', onMsg); };
      this.on('message', onMsg);
      this.send(msgType, typeName, obj);
    });
  }
}
