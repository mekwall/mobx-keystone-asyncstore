import createDebug from "debug";
import { action, observable, reaction, computed } from "mobx";
import {
  ExtendedModel,
  model,
  Model,
  ModelClass,
  modelFlow,
  ModelProps,
  _async,
  prop_mapObject,
  modelAction,
  ModelClassDeclaration,
  AnyModel,
} from "mobx-keystone";
import { createAsyncContainer } from "./AsyncContainer";

// Used internally so that the names of the generated models do not clash
let id = -1;

export interface AsyncStoreOptions<T> {
  name?: string;
  fetchOne?(id: string): Promise<T | undefined>;
  fetchMany?(ids: string[]): Promise<Array<T>>;
  fetchAll?(): Promise<Array<T>>;
  ttl?: number;
  failstateTtl?: number;
  batchSize?: number;
  throttle?: number;
}

// We cannot explicitly define a return type here
// since it's generated
// eslint-disable-next-line
export function AsyncStore<
  AModel extends ModelClass<AnyModel>,
  AProps extends AsyncStoreOptions<InstanceType<AModel>>,
  TProps extends ModelProps
>(ItemModel: AModel, asyncProps: AProps, modelProps: TProps = {} as TProps) {
  id++;
  const {
    name = `AsyncStore(${id})`,
    fetchOne,
    fetchMany,
    fetchAll,
    batchSize = 40,
    throttle = 200,
  } = asyncProps;

  const AsyncContainer = createAsyncContainer(ItemModel, {
    ...asyncProps,
    name,
  });

  const BaseAsyncStoreModel = Model({
    containers: prop_mapObject<
      Map<string, InstanceType<typeof AsyncContainer>>
    >(() => new Map()),
  });

  const debug = createDebug(`mobx-keystone:${name}`);

  @model(`asyncStores/Base${name}`)
  class BaseAsyncStore extends BaseAsyncStoreModel {
    private fetchQueue = observable.array<string>([]);
    @observable
    public isReady = false;
    @observable
    public isPending = false;
    @observable
    public hasAll = false;

    @computed
    public get values(): InstanceType<typeof AsyncContainer>[] {
      return [...this.containers.values()];
    }

    @computed
    public get errors(): Record<string, Error> {
      const errors: Record<string, Error> = {};
      return this.values.reduce((acc, c) => {
        if (c.error) {
          return { ...acc, [c.id]: c.error };
        }
        return acc;
      }, errors);
    }

    @computed
    get inFailstate() {
      return Object.keys(this.errors).length > 0;
    }

    public onInit() {
      debug("onInit()");
      const dispose = reaction(
        () => !this.isPending && this.fetchQueue.length > 0,
        this.fetchQueueExecutor,
        {
          fireImmediately: true,
          scheduler: this.fetchQueueScheduler,
        }
      );

      /* istanbul ignore next */
      return () => {
        dispose();
      };
    }

    private fetchQueueExecutor = async (shouldFetch: boolean) => {
      debug("fetchQueueExecutor()", shouldFetch);
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
    };

    private fetchQueueScheduler(run: () => void) {
      setTimeout(run, throttle);
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
      const ct = this.containers.get(id);
      try {
        const item: InstanceType<AModel> | undefined = fetchOne
          ? yield fetchOne.call(this, id)
          : // We do know that we have fetchMany here
            // eslint-disable-next-line
            yield fetchMany!.call(this, [id]);
        ct?.setValue(item);
      } catch (e) {
        ct?.setFailstate(e);
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
        const items = yield fetchMany.call(this, ids);
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
      const items = yield fetchAll.call(this);
      if (items.length > 0) {
        items.forEach((item: InstanceType<AModel> & { id: string }) => {
          const id = item.id;
          const ct = this.containers.get(id) || new AsyncContainer({ id });
          const idx = this.fetchQueue.indexOf(item.$modelId);
          this.fetchQueue.splice(idx, 1);
          ct.setValue(item);
          this.containers.set(id, ct);
        });
      }
      this.hasAll = true;
      this.setReady();
    });

    @action
    private spliceFetchQueue(start: number, end: number) {
      debug(`spliceFetchQueue()`, start, end);
      return this.fetchQueue.splice(start, end);
    }

    @action
    private setReady(): void {
      debug(`setReady()`);
      this.isPending = false;
      this.isReady = true;
    }

    @action
    private setPending(): void {
      debug(`setPending()`);
      this.isPending = true;
    }

    // Usually only used by AsyncContainer to add itself to
    // the fetch queue
    public addToFetchQueue(id: string | string[]): void {
      debug(`addToFetchQueue()`, id);
      if (Array.isArray(id)) {
        this.fetchQueue.push(...id);
      } else {
        this.fetchQueue.push(id);
      }
    }

    @modelAction
    public getOne(id: string): InstanceType<typeof AsyncContainer> {
      let ct = this.containers.get(id);
      debug(`getOne()`, id, ct);
      if (!ct) {
        ct = new AsyncContainer({ id });
        this.containers.set(id, ct);
      }
      if (ct.shouldFetch && !this.fetchQueue.includes(id)) {
        ct.setPending();
        this.addToFetchQueue(id);
      }
      return ct;
    }

    @modelAction
    public getMany(ids: string[]): InstanceType<typeof AsyncContainer>[] {
      debug(`getMany()`, ids);
      const idsToFetch: string[] = [];
      const cts = ids.map((id) => {
        let ct = this.containers.get(id);
        if (!ct) {
          ct = new AsyncContainer({ id });
          this.containers.set(id, ct);
        }
        if (ct.shouldFetch) {
          ct.setPending();
          idsToFetch.push(id);
        }
        return ct;
      });
      if (idsToFetch.length > 0) {
        this.addToFetchQueue(idsToFetch);
      }
      return cts;
    }

    @modelAction
    public getAll(force = false): InstanceType<typeof AsyncContainer>[] {
      debug(`getAll()`, force);
      if (force || (!this.hasAll && !this.fetchQueue.includes("*"))) {
        this.addToFetchQueue("*");
      }
      return this.values;
    }

    @modelAction
    public createAsyncContainer(id: string, add = false) {
      debug(`createAsyncContainer()`, id, add);
      if (this.containers.has(id)) {
        return this.containers.get(id);
      }
      const ct = new AsyncContainer({ id });
      if (add) {
        this.containers.set(id, ct);
      }
      return ct;
    }
  }

  const ExportedBaseAsyncStore = BaseAsyncStore as ModelClassDeclaration<
    typeof BaseAsyncStoreModel,
    IBaseAsyncStore<InstanceType<typeof AsyncContainer>>
  >;
  return ExtendedModel(ExportedBaseAsyncStore, modelProps);
}

export interface IBaseAsyncStore<T> {
  containers: Map<string, T>;
  values: T[];
  isReady: boolean;
  isPending: boolean;
  inFailstate: boolean;
  errors?: Record<string, Error>;
  hasAll: boolean;
  addToFetchQueue(id: string | string[]): void;
  getOne(id: string): T;
  getMany(id: string[]): T[];
  getAll(force?: boolean): T[];
  createAsyncContainer(id: string, add?: boolean): T;
}
