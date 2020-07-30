import "jest";
import { when } from "mobx";
import { model, Model, tProp, types, modelAction } from "mobx-keystone";
import { AsyncStore, AsyncStoreOptions } from "../AsyncStore";

function createTodoStore(
  name: string,
  opts: Partial<AsyncStoreOptions<any>> = {}
) {
  @model(name + "TodoModel")
  class TodoModel extends Model({
    task: tProp(types.string, "Task"),
    done: tProp(types.boolean, false),
  }) {
    @modelAction
    toggleDone() {
      this.done = !this.done;
    }
  }

  const todoList = [
    new TodoModel({ $modelId: "0", task: "Do it 0" }),
    new TodoModel({ $modelId: "1", task: "Do it 1" }),
    new TodoModel({ $modelId: "2", task: "Do it 2" }),
  ];

  @model(name + "TodoStore")
  class TodoStore extends AsyncStore(TodoModel, {
    ...{ name: name + "BaseStore", ...opts },
    async fetchAll() {
      return todoList;
    },
    async fetchMany(ids: string[]) {
      return todoList.filter((t) => ids.includes(t.$modelId));
    },
    async fetchOne(id: string) {
      return todoList.filter((t) => id === t.$modelId)[0];
    },
  }) {}
  return TodoStore;
}

describe("AsyncStore", () => {
  it("should create AsyncStore", () => {
    const TodoStore = createTodoStore("stores/Test1");
    const todoStore = new TodoStore({});
    expect(todoStore).toBeInstanceOf(TodoStore);
  });

  it("should fetch one item", async () => {
    const TodoStore = createTodoStore("stores/Test2");
    const todoStore = new TodoStore({});
    const container = todoStore.getOne("0");
    expect(container.$modelId).toBeDefined();
    await when(() => container.isReady);
    const todo = container.value;
    expect(todo).toBeDefined();
    expect(todo?.$modelId).toBe("0");
    expect(todo?.task).toBe("Do it 0");
  });

  it("should fetch many items", async () => {
    const TodoStore = createTodoStore("stores/Test3");
    const todoStore = new TodoStore({});
    const containers = todoStore.getMany(["0", "1", "2"]);
    expect(todoStore.isReady).toBe(false);
    await when(() => todoStore.isPending);
    expect(containers.length).toBe(3);
    await when(() => !todoStore.isPending && todoStore.isReady);
    expect(todoStore.isReady).toBe(true);
    containers.forEach((c, i) => {
      const todo = c.value;
      expect(todo).toBeDefined();
      expect(todo?.$modelId).toBe(`${i}`);
      expect(todo?.task).toBe("Do it " + i);
    });
  });

  it("should fetch all items", async () => {
    const TodoStore = createTodoStore("stores/Test4");
    const todoStore = new TodoStore({});
    todoStore.getAll();
    expect(todoStore.isReady).toBe(false);
    await when(() => todoStore.isPending);
    await when(() => !todoStore.isPending && todoStore.isReady);
    todoStore.containers.forEach((c, i) => {
      const todo = c.value;
      expect(todo).toBeDefined();
      expect(todo?.$modelId).toBe(`${i}`);
      expect(todo?.task).toBe("Do it " + i);
    });
  });

  it("should create container", async () => {
    const TodoStore = createTodoStore("stores/Test5");
    const todoStore = new TodoStore({});
    const ct1 = todoStore.createAsyncContainer("test1", true);
    const ct2 = todoStore.createAsyncContainer("test2", false);
    expect(ct1).toBeDefined();
    expect(ct2).toBeDefined();
    expect(todoStore.containers.has("test1")).toBe(true);
    expect(todoStore.containers.has("test2")).toBe(false);
  });

  it("should not fetch when we already have", async () => {
    const TodoStore = createTodoStore("stores/Test6");
    const todoStore = new TodoStore({});
    const addToFetchQueueSpy = jest.spyOn(todoStore, "addToFetchQueue");
    const spliceQueueSpy = jest.spyOn(todoStore, "spliceFetchQueue");
    const fetchAllSpy = jest.spyOn(todoStore, "fetchAll");
    const fetchOneSpy = jest.spyOn(todoStore, "fetchOne");
    todoStore.getAll();
    await when(() => !todoStore.isPending && todoStore.isReady);
    const cts = todoStore.getAll();
    const ct = todoStore.getOne("0");
    const cts2 = todoStore.getMany(["1", "2"]);
    await when(() => ct.isReady);
    expect(todoStore.containers.size).toBe(3);
    expect(cts[0]).toBe(ct);
    expect(cts2[0]).toBe(cts[1]);
    expect(cts2[1]).toBe(cts[2]);
    expect(fetchAllSpy).toBeCalledTimes(1);
    expect(spliceQueueSpy).toBeCalledTimes(1);
    expect(addToFetchQueueSpy).toBeCalledTimes(1);
    expect(fetchOneSpy).toBeCalledTimes(0);
  });
});
