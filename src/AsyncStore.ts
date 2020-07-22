import { action, computed, observable, reaction, ObservableMap } from "mobx";
import {
  AnyModel,
  ExtendedModel,
  model,
  Model,
  ModelClass,
  modelFlow,
  ModelProps,
  prop,
  _async,
  _Model,
  prop_mapObject,
  modelAction,
  getParent,
  tProp,
  types,
  ModelClassDeclaration,
} from "mobx-keystone";

// Used internally so that the names of the generated models do not clash
let id = -1;

export interface AsyncStoreOptions<T> {
  fetchOne?(id: string): Promise<T | undefined>;
  fetchMany?(ids: string[]): Promise<Array<T>>;
  fetchAll?(): Promise<Array<T>>;
  ttl?: number;
  failstateTtl?: number;
  batchSize?: number;
  throttle?: number;
}

export function AsyncStore<
  AModel extends ModelClass<AnyModel>,
  AProps extends AsyncStoreOptions<InstanceType<AModel>>,
  TProps extends ModelProps
>(ItemModel: AModel, asyncProps: AProps, modelProps: TProps = {} as TProps) {
  const {
    fetchOne,
    fetchMany,
    fetchAll,
    ttl = Infinity,
    failstateTtl = 10000,
    batchSize = 40,
    throttle = 200,
  } = asyncProps;

  id++;

  const AsyncContainerModel = Model({
    id: prop<string>(),
    _value: tProp(types.maybe(types.model(ItemModel))),
  });

  type AsyncContainerDeclaration = ModelClassDeclaration<
    typeof AsyncContainerModel,
    IAsyncContainer<InstanceType<AModel>>
  >;

  @model(`stores/AsyncContainer(${id})`)
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
          const parent = getParent<BaseAsyncStore>(this);
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
      if (ttl) {
        this.expiresAt = Date.now() + ttl;
      }
      this.isReady = true;
      this._value = value;
    }

    @modelAction
    public setPending(pending = true) {
      this.isPending = pending;
    }

    @modelAction
    public setFailstate(error?: Error) {
      this.error = error;
    }
  }

  const BaseAsyncStoreModel = Model({
    containers: prop_mapObject<
      Map<string, IAsyncContainer<InstanceType<AModel>>>
    >(() => new Map()),
  });

  @model(`stores/BaseAsyncStore(${id})`)
  class BaseAsyncStore extends BaseAsyncStoreModel {
    private fetchQueue = observable.array<string>([]);
    @observable
    public isReady = false;
    @observable
    public isPending = false;
    @observable
    public error?: Error;
    @observable
    public hasAll = false;

    public onInit() {
      const dispose = reaction(
        () => !this.isPending && this.fetchQueue.length > 0,
        async (shouldFetch) => {
          if (shouldFetch) {
            // Prioratize fetching all
            const fetchAllIndex = this.fetchQueue.indexOf("*");
            if (fetchAllIndex !== -1) {
              this.spliceFetchQueue(fetchAllIndex, 1);
              await this.fetchAll();
            } else {
              const idsToFetch = this.spliceFetchQueue(0, batchSize);
              if (idsToFetch.length === 1) {
                await this.fetchOne(idsToFetch[0]);
              } else {
                await this.fetchMany(idsToFetch);
              }
            }
          }
        },
        { delay: throttle, fireImmediately: true }
      );

      return () => {
        dispose();
      };
    }

    @modelFlow
    private fetchOne: (id: string) => Promise<void> = _async(function* (
      this: BaseAsyncStore,
      id: string
    ) {
      if (!fetchOne && !fetchMany) {
        throw Error("Not implemented");
      }
      this.setPending();
      const ct = this.containers.get(id)!;
      try {
        const item: InstanceType<AModel> | undefined = fetchOne
          ? yield fetchOne(id)
          : yield fetchMany!([id]);
        ct.setValue(item);
      } catch (e) {
        ct.setFailstate(e);
      }
      this.setReady();
    });

    @modelFlow
    private fetchMany: (ids: string[]) => Promise<void> = _async(function* (
      this: BaseAsyncStore,
      ids: string[]
    ) {
      if (!fetchMany) {
        throw new Error("Not implemented");
      }
      this.setPending();
      const cts = ids.map((id) => {
        let ct = this.containers.get(id);
        if (!ct) {
          console.warn(
            "Container doesn't exist. This shoudldn't be happening."
          );
          ct = new AsyncContainer({ id });
          this.containers.set(id, ct);
        }
        ct?.setPending();
        return ct;
      });
      try {
        const items = yield fetchMany(ids);
        items.forEach((item: InstanceType<AModel>) => {
          const ct = this.containers.get(item.$modelId);
          ct?.setValue(item);
        });
      } catch (e) {
        console.error(e);
        cts.forEach((ct) => {
          ct.setFailstate(e);
        });
      }
      this.setReady();
    });

    @modelFlow
    private fetchAll: () => Promise<void> = _async(function* (
      this: BaseAsyncStore
    ) {
      if (!fetchAll) {
        throw new Error("Not implemented");
      }
      this.setPending();
      const items = yield fetchAll();
      if (items.length > 0) {
        items.forEach((item: InstanceType<AModel>) => {
          const ct =
            this.containers.get(item.$modelId) ||
            new AsyncContainer({ id: item.$modelId });
          const idx = this.fetchQueue.indexOf(item.$modelId);
          this.fetchQueue.splice(idx, 1);
          ct.setValue(item);
          this.containers.set(item.$modelId, ct);
        });
      }
      this.hasAll = true;
      this.setReady();
    });

    @action
    private spliceFetchQueue(start: number, end: number) {
      return this.fetchQueue.splice(start, end);
    }

    @action
    private setReady(): void {
      this.isPending = false;
      this.isReady = true;
    }

    @action
    private setPending(): void {
      this.isPending = true;
    }

    @action
    private setFailstate(error?: Error): void {
      this.error = error;
    }

    // Usually only used by AsyncContainer to add itself to
    // the fetch queue
    public addToFetchQueue(id: string | string[]): void {
      if (Array.isArray(id)) {
        this.fetchQueue.push(...id);
      } else {
        this.fetchQueue.push(id);
      }
    }

    @modelAction
    public getOne(id: string): IAsyncContainer<InstanceType<AModel>> {
      const ct = this.containers.get(id) || new AsyncContainer({ id });
      this.containers.set(id, ct);
      if (ct.shouldFetch && !this.fetchQueue.includes(id)) {
        this.addToFetchQueue(id);
      }
      return ct;
    }

    @modelAction
    public getMany(ids: string[]): IAsyncContainer<InstanceType<AModel>>[] {
      const cts = ids.map((id) => {
        let ct = this.containers.get(id);
        if (!ct) {
          ct = new AsyncContainer({ id });
          this.containers.set(id, ct);
        }
        return ct;
      });
      this.addToFetchQueue(ids);
      return cts;
    }

    @modelAction
    public getAll(): IAsyncContainer<InstanceType<AModel>>[] {
      if (!this.hasAll && !this.fetchQueue.includes("*")) {
        this.addToFetchQueue("*");
      }
      return Object.values(this.containers).map((c) => c);
    }
  }

  return ExtendedModel(
    (BaseAsyncStore as unknown) as ModelClassDeclaration<
      typeof BaseAsyncStoreModel,
      IBaseAsyncStore<IAsyncContainer<InstanceType<AModel>>>
    >,
    modelProps
  );
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

export interface IBaseAsyncStore<T> {
  containers: Map<string, T>;
  fetchQueue: ObservableMap<string>;
  isReady: boolean;
  isPending: boolean;
  error?: Error;
  hasAll: boolean;
  fetchOne: (id: string) => Promise<void>;
  fetchMany: (id: string[]) => Promise<void>;
  fetchAll: (id: string[]) => Promise<void>;
  spliceFetchQueue(start: number, end: number): void;
  setReady(): void;
  setPending(): void;
  setFailstate(error?: Error): void;
  addToFetchQueue(id: string | string[]): void;
  getOne(id: string): T;
  getMany(id: string[]): T[];
  getAll(): T[];
}
