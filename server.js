const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let posts = [];

app.get("/api/posts", (req, res) => {
  res.json(posts);
});

app.post("/api/posts", (req, res) => {
  const text = (req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Text required" });

  const post = {
    id: Date.now().toString(),
    text,
    time: Date.now()
  };

  posts.push(post);
  res.json(post);
});

app.delete("/api/posts", (req, res) => {
  posts = [];
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
