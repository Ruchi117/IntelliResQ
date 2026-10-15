
import sqlite3

conn = sqlite3.connect("intelliresq.db")
conn.row_factory = sqlite3.Row

rows = conn.execute(
    "SELECT * FROM emergencies"
).fetchall()

for row in rows:
    print(dict(row))

conn.close()
