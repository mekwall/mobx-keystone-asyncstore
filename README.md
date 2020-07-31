# mobx-keystone-asyncstore

_An opinionated asynchronous store and container implementation for [mobx-keystone](https://mobx-keystone.js.org/)._

[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/mekwall/mobx-keystone-asyncstore/blob/master/LICENSE)
[![npm](https://img.shields.io/npm/v/mobx-keystone-asyncstore.svg?style=flat-square&logo=npm)](https://www.npmjs.com/package/mobx-keystone-asyncstore)
![types](https://img.shields.io/npm/types/mobx-keystone-asyncstore.svg?style=flat-square&logo=typescript)
[![build](https://img.shields.io/endpoint.svg?url=https%3A%2F%2Factions-badge.atrox.dev%2Fmekwall%2Fmobx-keystone-asyncstore%2Fbadge%3Fref%3Dmaster&label=build&style=flat-square)](https://actions-badge.atrox.dev/mekwall/mobx-keystone-asyncstore/goto?ref=master)
[![coverage](https://img.shields.io/codecov/c/github/mekwall/mobx-keystone-asyncstore?style=flat-square)](https://codecov.io/github/mekwall/mobx-keystone-asyncstore?branch=master)
[![quality](https://img.shields.io/lgtm/grade/javascript/github/mekwall/mobx-keystone-asyncstore?style=flat-square)](https://lgtm.com/projects/g/mekwall/mobx-keystone-asyncstore/?mode=list)

> ⚠️**WARNING**: This library is under development and not yet considered stable. Use with caution as breaking changes to the API may be introduced until reaching v1.

## Introduction

One of the most common challenges when implementing a store solution is how to handle asynchronous data sets. mobx-keystone-asyncstore aims to simplify this by allowing you to create powerful asynchronous stores with just a few lines of code. An mobx-keystone-asyncstore implements the most common fetch patterns and support fetch queues, fail states and time to live out of the box.

Let's look at a simple implementation of a TodoStore:

```ts
import axios from "axios";
import { when } from "mobx";
import { model, modelAction, Model, tProp, types } from "mobx-keystone";
import { AsyncStore } from "mobx-keystone-asyncstore";

// Create main model
@model("models/TodoItem")
class TodoItem extends Model({
  id: tProp(types.string),
  task: tProp(types.string),
  done: tProp(types.boolean, false),
}) {
  @modelAction
  public toggleDone() {
    this.done = !!this.done;
  }
}

// Create async store
const storeName = "stores/TodoStore";
@model(storeName)
class TodoStore extends AsyncStore(
  TodoItem,
  {
    name: storeName,
    // Logic to fetch one item
    async fetchOne(id: string) {
      const res = await axios.get(`/todos/${id}`);
      return new TodoItem(res.data);
    },
    // Logic to fetch many items
    async fetchMany(ids: string[]) {
      const res = await axios.get(`/todos`, { ids });
      return res.data.response.map((d: any) => new TodoItem(d));
    },
    // Logic to fetch all items
    async fetchAll() {
      const res = await axios.get(`/todos/all`);
      return res.data.response.map((d: any) => new TodoItem(d));
    },
  },
  {
    // Add additional model props for the store
    isDirty: tProp(types.boolean, true),
  }
) {
  @modelAction
  public setDirty(isDirty = true) {
    this.isDirty = isDirty;
  }

  // Add additional methods for the store
  @modelAction
  public addTodo(task: TodoItem) {
    // Create container that will contain our task
    const container = this.createAsyncContainer(task.id);
    // Add task to container value
    container.setValue(task);
    // Add container to store
    this.containers.set(task.id, container);
    // Set the store as dirty
    this.setDirty();
    // Let's return the container so it may be used
    return container;
  }

  // Method to save all our todos
  async saveToDb() {
    if (this.isDirty) {
      const res = await axios.post(`/todos`, this.values);
      if (res.status === 200) {
        this.setDirty(false);
      }
    }
  }
}

// Create store instance
const todoStore = new TodoStore({});

// Ask the store to return container with id 'foo'
const container = todoStore.getOne("foo");

// Wait for the container to be ready to be consumed
when(
  () => container.isReady,
  () => {
    const todo = container.value;
    // todo is an instance of TodoItem
    todo.toggleDone();
  }
);

// Add a new todo to the store
todoStore.addTodo(
  new TodoItem({
    id: "bar",
    task: "Do this thing as well",
  })
);

// Use our custom save method
todoStore.saveToDb();
```
