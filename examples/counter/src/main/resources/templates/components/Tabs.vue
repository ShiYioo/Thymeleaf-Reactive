<template>
  <div class="tabs">
    <button class="to-a" @click="tab = 'a'">A</button>
    <button class="to-b" @click="tab = 'b'">B</button>
    <span class="tabs-version">{{ version }}</span>
    <keep-alive>
      <input v-if="tab === 'a'" key="a" aria-label="kept-input">
      <p v-else key="b">Branch B</p>
    </keep-alive>
    <transition mode="out-in" name="fade">
      <em v-if="tab === 'a'" key="ta">A view</em>
      <strong v-else key="tb">B view</strong>
    </transition>
  </div>
</template>
<script setup>
const tab = ref('a');
const version = ref('v1');
</script>
