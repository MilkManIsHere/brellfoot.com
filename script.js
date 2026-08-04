async function loadPosts() {
  const res = await fetch("/api/posts");
  return await res.json();
}

async function render() {
  const posts = await loadPosts();
  const container = document.getElementById("posts");
  container.innerHTML = "";

  posts.slice().reverse().forEach(post => {
    const div = document.createElement("div");
    div.className = "post";
    div.innerHTML = `
      <small>Anonymous • ${new Date(post.time).toLocaleString()}</small>
      <p>${escapeHTML(post.text)}</p>
    `;
    container.appendChild(div);
  });
}

async function postMessage() {
  const box = document.getElementById("message");
  const text = box.value.trim();
  if (!text) return;

  await fetch("/api/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  box.value = "";
  render();
}

async function clearPosts() {
  if (!confirm("Delete all posts?")) return;

  await fetch("/api/posts", { method: "DELETE" });
  render();
}

function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

render();
