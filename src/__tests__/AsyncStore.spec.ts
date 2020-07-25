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

  @model(name + "BaseStore")
  class TodoStore extends AsyncStore(TodoModel, {
    ...opts,
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
    const TodoStore = createTodoStore("Test1");
    const todoStore = new TodoStore({});
    expect(todoStore).toBeInstanceOf(TodoStore);
  });

  it("should fetch one item", async () => {
    const TodoStore = createTodoStore("Test2");
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
    const TodoStore = createTodoStore("Test3");
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
    const TodoStore = createTodoStore("Test4");
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
    const TodoStore = createTodoStore("Test5");
    const todoStore = new TodoStore({});
    const ct1 = todoStore.createAsyncContainer("test1", true);
    const ct2 = todoStore.createAsyncContainer("test2", false);
    expect(ct1).toBeDefined();
    expect(ct2).toBeDefined();
    expect(todoStore.containers.has("test1")).toBe(true);
    expect(todoStore.containers.has("test2")).toBe(false);
  });
});
