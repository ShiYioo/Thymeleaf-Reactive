<template>
  <main>
    <h1>Counter</h1>
    <p>{{ count }}</p>
    <input v-model="count" aria-label="count">
    <button @click="increment">Increment</button>
    <button @click="toggle">Toggle message</button>
    <p v-if="visible">Reactive Thymeleaf is live.</p>
  </main>
</template>
