import type { RpcMap } from './lib/domain';

declare module 'webext-bridge' {
    export interface ProtocolMap extends RpcMap {}
}
