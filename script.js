let posts = JSON.parse(localStorage.getItem("posts")) || [];

function save(){
    localStorage.setItem("posts", JSON.stringify(posts));
}

function render(){

    const container = document.getElementById("posts");
    container.innerHTML = "";

    posts.slice().reverse().forEach(post=>{

        const div = document.createElement("div");
        div.className = "post";

        div.innerHTML = `
            <small>Anonymous • ${new Date(post.time).toLocaleString()}</small>
            <p>${escapeHTML(post.text)}</p>
        `;

        container.appendChild(div);

    });

}

function postMessage(){

    const box = document.getElementById("message");

    if(box.value.trim()==="") return;

    posts.push({
        text:box.value,
        time:Date.now()
    });

    save();
    render();

    box.value="";

}

function clearPosts(){

    if(confirm("Delete all posts?")){

        posts=[];
        save();
        render();

    }

}

function escapeHTML(text){

    return text
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;");

}

render();
