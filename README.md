# mobx-keystone-asyncstore

_An opinionated asynchronous store and container implementation for [mobx-keystone](https://mobx-keystone.js.org/)._

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/mekwall/mobx-keystone-asyncstore/blob/master/LICENSE)

> ⚠️ This library is under development and not yet considered stable. Use with caution as breaking changes to the API may be introduced until reaching v1.

## Introduction

One of the most common challenges when implementing a store solution is how to handle asynchronous data sets. mobx-keystone-asyncstore aims to simplify this by allowing you to create powerful asynchronous stores with just a few lines of code. An mobx-keystone-asyncstore implements the most common fetch patterns and support fetch queues, fail states and time to live out of the box.

It's as simple as this:

```ts
import axios from "axios";
import { when } from "mobx";
import { model, modelAction, Model, tProps } from "mobx-keystone";
import { AsyncStore } from "mobx-keystone-asyncstore";

// Create main model
@model("models/TodoItem")
class TodoItem extends Model({
  task: tProps(types.string),
  done: tProps(types.boolean, false)
}){
  @modelAction
  public toggleDone() {
    this.done = !!this.done;
  }
};

// Create async store
const storeName = "stores/TodoStore";
@model(storeName)
class TodoStore extends AsyncStore(TodoItem, {
  { name: storeName },
  // Logic to fetch one item
  async fetchOne(id: string) {
    const res = await axios.get(`/todos/${id}`);
    return new TodoItem(res.data);
  },
  // Logic to fetch many items
  async fetchMany(ids: string[]) {
    const res = await axios.get(`/todos`, { ids });
    return res.data.response.map((d) => new TodoItem(d));
  },
  // Logic to fetch all items
  async fetchAll() {
    const res = await axios.get(`/todos/all`);
    return res.data.response.map((d) => new TodoItem(d));
  },
}, {
  // Add additional model props for the store
  extraModelProp: tProp(types.boolean, true)
}) {
  // Add additional methods for the store
  @modelAction
  public toggleExtraProp() {
    this.extraModelProp = !!this.extraModelProp;
  }
}

// Create store instance
const todoStore = new TodoStore({});

// Ask the store to return container with id 'foo'
const container = todoStore.get('foo');

// Wait for the container to be ready to be consumed
when(
  () => container.isReady,
  () => {
    const todo = container.value;
    // todo is an instance of TodoItem
    todo.toggleDone();
  }
);
```
