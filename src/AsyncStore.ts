import { action, observable, reaction, computed } from "mobx";
import {
  AnyModel,
  ExtendedModel,
  model,
  Model,
  ModelClass,
  modelFlow,
  ModelProps,
  _async,
  _Model,
  prop_mapObject,
  modelAction,
  ModelClassDeclaration,
} from "mobx-keystone";
import { createAsyncContainer, IAsyncContainer } from "./AsyncContainer";

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
    batchSize = 40,
    throttle = 200,
  } = asyncProps;

  id++;

  const AsyncContainer = createAsyncContainer(ItemModel, asyncProps);

  const BaseAsyncStoreModel = Model({
    containers: prop_mapObject<
      Map<string, InstanceType<typeof AsyncContainer>>
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

    @computed
    public get values(): InstanceType<typeof AsyncContainer>[] {
      return [...this.containers.values()];
    }

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
        {
          fireImmediately: true,
          scheduler: (run) => {
            return setTimeout(run, throttle);
          },
        }
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
          ? yield fetchOne.call(this, id)
          : yield fetchMany!.call(this, [id]);
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
    public getOne(id: string): InstanceType<typeof AsyncContainer> {
      const ct = this.containers.get(id) || new AsyncContainer({ id });
      this.containers.set(id, ct);
      if (ct.shouldFetch && !this.fetchQueue.includes(id)) {
        this.addToFetchQueue(id);
      }
      return ct;
    }

    @modelAction
    public getMany(ids: string[]): InstanceType<typeof AsyncContainer>[] {
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
    public getAll(force = false): InstanceType<typeof AsyncContainer>[] {
      if (force || (!this.hasAll && !this.fetchQueue.includes("*"))) {
        this.addToFetchQueue("*");
      }
      return this.values;
    }

    @modelAction
    public createAsyncContainer(id: string, add = false) {
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
  isReady: boolean;
  isPending: boolean;
  error?: Error;
  hasAll: boolean;
  addToFetchQueue(id: string | string[]): void;
  getOne(id: string): T;
  getMany(id: string[]): T[];
  getAll(force?: boolean): T[];
  createAsyncContainer(id: string, add?: boolean): T;
}
