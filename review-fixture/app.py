import sqlite3

from flask import Flask, request

app = Flask(__name__)


@app.get("/users")
def users():
    name = request.args.get("name", "")
    with sqlite3.connect("users.db") as connection:
        rows = connection.execute(
            "SELECT id, name FROM users WHERE name = '" + name + "'"
        ).fetchall()
    return {"users": rows}
