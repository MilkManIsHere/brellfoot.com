const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve files from the root directory
app.use(express.static(__dirname));

let posts = [];

app.get("/api/posts", (req, res) => {
    res.json(posts);
});

app.post("/api/posts", (req, res) => {
    const text = (req.body.text || "").trim();

    if (!text) {
        return res.status(400).json({ error: "Message required" });
    }

    const post = {
        id: Date.now(),
        text,
        time: Date.now()
    };

    posts.push(post);
    res.json(post);
});

app.delete("/api/posts", (req, res) => {
    posts = [];
    res.json({ success: true });
});

// Open index.html when visiting /
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
