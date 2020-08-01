import createDebug from "debug";
import {
  Model,
  prop,
  types,
  tProp,
  modelAction,
  ModelClass,
  AnyModel,
  ModelClassDeclaration,
  model,
  getParent,
} from "mobx-keystone";
import { AsyncStoreOptions, IBaseAsyncStore } from "./AsyncStore";
import { observable, computed } from "mobx";
import nextTick from "next-tick";

export interface AsyncContainerOptions<T> extends AsyncStoreOptions<T> {
  name: string;
}

// We cannot explicitly define a return type here
// since it's generated
// eslint-disable-next-line
export function createAsyncContainer<
  AModel extends ModelClass<AnyModel>,
  AProps extends AsyncContainerOptions<InstanceType<AModel>>
>(ItemModel: AModel, asyncProps: AProps) {
  const { name, ttl = Infinity, failstateTtl = 5000 } = asyncProps;
  const AsyncContainerModel = Model({
    id: prop<string>(),
    _value: tProp(types.maybe(types.model(ItemModel))),
  });

  const debug = createDebug(`mobx-keystone:${name}Container`);

  @model(`asyncStores/containers/${name})`)
  class AsyncContainer extends AsyncContainerModel
    implements IAsyncContainer<InstanceType<AModel>> {
    @observable
    public isReady = false;
    @observable
    public isPending = false;
    @observable.ref
    public error: Error | undefined = undefined;
    @observable
    public lastModified = Infinity;
    @observable
    public expiresAt = Infinity;

    @computed
    get value(): InstanceType<AModel> | undefined {
      if (this.shouldFetch) {
        nextTick(() => {
          // Need to check shouldFetch again to avoid race-conditions
          // This is cheap since it's memoized
          if (this.shouldFetch) {
            // Get the store this container is part of
            const parent = getParent<IBaseAsyncStore<InstanceType<AModel>>>(
              this
            );
            debug("parent.addToFetchQueue()", parent);
            if (parent?.addToFetchQueue) {
              // Add itself to the fetch queue
              parent.addToFetchQueue(this.id);
            }
          }
        });
      }
      return this._value;
    }

    @computed
    public get shouldFetch() {
      return (
        !this.isPending &&
        (!this.isReady || this.hasExpired) &&
        !this.inFailstate
      );
    }

    // Do not make computed
    public get inFailstate() {
      if (failstateTtl > 0) {
        return !!this.error && !this.hasExpired;
      } else {
        return !!this.error;
      }
    }

    // Do not make computed
    public get hasExpired() {
      if (this.expiresAt === Infinity) {
        return false;
      }
      return this.expiresAt >= Date.now();
    }

    @modelAction
    public setValue(value?: InstanceType<AModel>) {
      debug("setValue()", value);
      this.error = undefined;
      this.isPending = false;
      this.isReady = true;
      this._value = value;
      this.lastModified = Date.now();
      this.expiresAt =
        ttl > 0 && ttl !== Infinity ? this.lastModified + ttl : 0;
    }

    @modelAction
    public setReady() {
      this.isPending = false;
      this.isReady = true;
    }

    @modelAction
    public setPending(isPending = true) {
      debug("setPending()", isPending);
      this.error = undefined;
      this.isPending = isPending;
    }

    @modelAction
    public setFailstate(error: Error) {
      debug("setFailstate()", error);
      this.isPending = false;
      this.isReady = true;
      this.error = error;
      this.lastModified = Date.now();
      this.expiresAt =
        failstateTtl > 0 && failstateTtl !== Infinity
          ? this.lastModified + failstateTtl
          : 0;
    }

    @modelAction
    public clearFailstate() {
      debug("clearFailstate()");
      this.error = undefined;
      this.expiresAt = Date.now() - 1;
    }
  }

  return AsyncContainer as ModelClassDeclaration<
    typeof AsyncContainerModel,
    IAsyncContainer<InstanceType<AModel>>
  >;
}

export interface IAsyncContainer<T> {
  isReady: boolean;
  isPending: boolean;
  error: Error | undefined;
  lastModified: number;
  expiresAt: number;
  value: T | undefined;
  inFailstate: boolean;
  shouldFetch: boolean;
  hasExpired: boolean;
  setReady(isReady: boolean): void;
  setPending(isPending?: boolean): void;
  setValue(value?: T): void;
  setFailstate(error: Error): void;
  clearFailstate(): void;
}
