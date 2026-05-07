<template>
  <main
    class="app-shell"
  >
    <RouterView />
  </main>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  box-sizing: border-box;
  background: #eef6ff;
}

:deep(nav) {
  display: flex;
  justify-content: center;
  color: #0f172a;
}
</style>
