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

let id = -1;

export interface AsyncContainerOptions<T> extends AsyncStoreOptions<T> {
  name: string;
}

export function createAsyncContainer<
  AModel extends ModelClass<AnyModel>,
  AProps extends AsyncContainerOptions<InstanceType<AModel>>
>(ItemModel: AModel, asyncProps: AProps) {
  const { name, ttl = Infinity, failstateTtl = 5000 } = asyncProps;

  id++;

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

    get value(): InstanceType<AModel> | undefined {
      if (this.shouldFetch) {
        // Need to check shouldFetch again to avoid race-conditions
        // This is cheap since it's memoized
        if (this.shouldFetch) {
          // Get the store this container is part of
          const parent = getParent<IBaseAsyncStore<InstanceType<AModel>>>(this);
          debug("parent.addToFetchQueue()", parent);
          if (parent?.addToFetchQueue) {
            // Add itself to the fetch queue
            parent.addToFetchQueue(this.id);
          }
        }
      }
      return undefined || this._value;
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
      if (ttl) {
        this.expiresAt = Date.now() + ttl;
      }
      this.isReady = true;
      this._value = value;
    }

    @modelAction
    public setPending(isPending = true) {
      debug("setPending()", isPending);
      this.isPending = isPending;
    }

    @modelAction
    public setFailstate(error?: Error) {
      debug("setFailstate()", error);
      this.error = error;
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
  setPending(pending?: boolean): void;
  setValue(value?: T): void;
  setFailstate(error?: Error): void;
}
