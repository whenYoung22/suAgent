简单做法是**让每条消息成为可独立跳过更新的组件**：

1. 给 `MessageItem` 加 `React.memo`。当前 store 更新 token 时，会创建新的活动消息对象，但保留其他消息对象的引用；因此未变化的历史消息可以跳过重新渲染。
2. 保持每条消息的 `key` 稳定。现有 `MessageList` 已使用 `message.id`，这点是对的。
3. 避免给每个消息传入每次渲染都会新建的对象或回调，否则 `memo` 的比较会失效。

概念上：

```tsx
export const MessageItem = React.memo(function MessageItem({
  message,
}: MessageItemProps) {
  // ...
})
```

这属于**React 组件层优化**：减少其他消息的重复渲染，改动较小，也不需要自建 Markdown 切块逻辑。

但它**不会**阻止活动消息的 Markdown 在每个 token 到来时重新解析；如果这成为实际性能问题，再考虑合并 token 更新或做块级增量。





不完全是。你把两个相关但不同的概念联系起来了：React.memo 和 Vue 的 key 都涉及减少不必要的工作，但它们解决的问题不同。

我们拆开看。

## 1. React.memo 是什么？

```
export const MessageItem = React.memo(function MessageItem({
  message,
}: MessageItemProps) {
  return <div>{message.content}</div>;
});
```

它的作用是：

当父组件重新渲染时，如果传给子组件的 props 没有变化，就跳过子组件的重新渲染。

默认使用浅比较（对 props 的各个属性进行 `Object.is` 比较）。

例如：

```
const oldMessage = {
  id: "1",
  content: "Hello",
};

const newMessage = {
  id: "1",
  content: "Hello",
};

console.log(oldMessage === newMessage); // false
```

虽然两个对象内容相同，但它们是不同的对象引用。

因此，如果每次更新都重新创建历史消息对象，`React.memo` 也无法跳过渲染。

## 2. Vue 的 key 是什么？

Vue 中：

```
<MessageItem
  v-for="message in messages"
  :key="message.id"
/>
```

`key` 主要用于 Virtual DOM Diff 时识别节点身份。

例如：

```
旧列表：
A  B  C

新列表：
A  C  D
```

Vue 可以通过 key 判断：

+ A 是原来的节点。
+ C 是原来的节点，只是位置发生变化。
+ B 被删除。
+ D 是新节点。

React 中的 `key` 也有类似作用。

```
{messages.map((message) => (
  <MessageItem
    key={message.id}
    message={message}
  />
))}
```

## 3. 两者的区别

| 对比             | React.memo             | React key    |
| ---------------- | ---------------------- | ------------ |
| 主要作用         | 跳过不必要的组件渲染   | 识别组件身份 |
| 工作机制         | Props 浅比较           | 协调与 Diff  |
| 是否控制组件复用 | 不直接控制             | 是           |
| 是否减少重复渲染 | 可以                   | 不保证       |
| Vue 中的对应概念 | 没有完全等价的直接对应 | Vue key      |

## 4. 放到你的 suAgent 中理解

假设当前有三条消息：

```
MessageList
├── MessageItem A
├── MessageItem B
└── MessageItem C（正在生成）
```

C 收到一个新 Token。

Zustand 更新后：

```
旧 messages：
[A, B, C]

新 messages：
[A, B, C']
```

这里假设：

+ A、B 的对象引用保持不变。
+ C' 是更新后的新对象。
+ 三条消息的 id 都不变。

那么：

1. `key` 告诉 React：A、B、C 仍然是原来的三个组件。
2. `React.memo` 比较 props：A、B 没变化，跳过重新渲染；C 变化了，重新渲染。

更新结果

MessageItem A

跳过渲染

MessageItem B

跳过渲染

MessageItem C

重新渲染

## 5. 你可以记住这个区别

+ `key`：告诉 React 谁是谁，帮助协调组件身份。
+ `React.memo`：判断 这个组件是否需要重新渲染。

两者配合使用，才能达到你在 suAgent 中想要的效果。

另外，你之前学习 Vue 时接触过虚拟 DOM Diff。可以把 React 的协调过程与 Vue 的 Diff 思想联系起来理解，但不要认为 `React.memo` 就是 React 版本的 `key`。它们处于不同层次。