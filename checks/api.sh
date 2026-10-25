#!/bin/bash

# Every database action of the api, on a throwaway database, studio_probe, dropped at the end.
# It prints each answer, with times blanked and downloads as a checksum, so a run before a
# change and one after can be compared:
#
#     checks/api.sh > /tmp/before.txt
#     (the change, and Studio started again)
#     checks/api.sh > /tmp/after.txt
#     diff /tmp/before.txt /tmp/after.txt
#
# Studio has to be running. Nothing but studio_probe is touched.

set -u
API="localhost:9900"
FILES=$(mktemp -d)
trap 'rm -rf "$FILES"' EXIT

# An action, as the page sends it.
A() {
    curl -s -X POST -H "X-Studio: 1" -H "Content-Type: application/json" "$API/api/action" -d "$1" \
        | sed -E 's/"time":[0-9]+/"time":0/g'
    echo
}

# A read, with the dates that change on their own blanked.
G() {
    curl -s "$API$1" | sed -E 's/"time":[0-9]+/"time":0/g; s/"(created|updated)":"[^"]*"/"\1":""/g'
    echo
}

# An export: the action that prepares it, then the download, as a checksum.
D() {
    id=$(A "$1" | python3 -c 'import json, sys; print(json.load(sys.stdin).get("id", ""))')
    curl -s "$API/api/db-export?id=$id" \
        | grep -v "^-- \(Dump completed\|Server version\|MariaDB dump\|Host:\)" | md5
}

if ! curl -s -o /dev/null "$API/api/config"; then
    echo "Studio is not running on $API" >&2
    exit 1
fi

mariadb -e "DROP DATABASE IF EXISTS studio_probe; CREATE DATABASE studio_probe; USE studio_probe;
    CREATE TABLE c (id int unsigned PRIMARY KEY, name varchar(20));
    CREATE TABLE t (id int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, c_id int unsigned,
        name varchar(40), note text, b blob, g int AS (id*2) VIRTUAL);
    INSERT INTO c VALUES (1,'one'),(2,'two');
    INSERT INTO t (c_id,name,note,b) VALUES (1,'alpha','x, \"y\"',0x00FF),(2,'beta',NULL,NULL),
        (NULL,'gamma','multi\nline',0xABCD);
    CREATE VIEW v AS SELECT id, name FROM t;"

# The reads.
G "/api/db-tables?db=studio_probe" | python3 -c '
import json, sys
print([ (t["name"], t["view"], t["engine"]) for t in json.load(sys.stdin) ])'
G "/api/db-structure?db=studio_probe&table=t" | md5
G "/api/db-rows?db=studio_probe&table=t&page=1&sort=name&dir=desc&filters=%5B%5D&match=all"
# The rows whose name holds an a: [{"column":"name","op":"contains","value":"a"}].
FILTER="%5B%7B%22column%22%3A%22name%22%2C%22op%22%3A%22contains%22%2C"
FILTER+="%22value%22%3A%22a%22%7D%5D"
G "/api/db-rows?db=studio_probe&table=t&filters=$FILTER"
G "/api/db-count?db=studio_probe&table=t&filters=%5B%5D"
G "/api/db-counts?db=studio_probe"
G "/api/engines" | md5

# The rows, the indexes, the foreign keys, the columns and the tables.
A '{"action":"db-row","db":"studio_probe","table":"t","keys":[{"id":"1"},{"id":"3"}],"hex":true}'
A '{"action":"db-row-save","db":"studio_probe","table":"t","key":{"id":"2"},
    "values":{"name":"BETA"}}'
A '{"action":"db-row-save","db":"studio_probe","table":"t","values":{"name":"delta"}}'
A '{"action":"db-rows-set","db":"studio_probe","table":"t","keys":[{"id":"1"}],"column":"note",
    "value":null}'
A '{"action":"db-row-delete","db":"studio_probe","table":"t","keys":[{"id":"4"}]}'
A '{"action":"db-index-add","db":"studio_probe","table":"t","kind":"index","name":"by_name",
    "columns":["name"]}'
A '{"action":"db-index-drop","db":"studio_probe","table":"t","name":"by_name"}'
A '{"action":"db-fk-save","db":"studio_probe","table":"t","name":"fk_c","columns":["c_id"],
    "refTable":"c","refColumns":["id"],"onDelete":"SET NULL"}'
A '{"action":"db-fk-save","db":"studio_probe","table":"t","columns":["name"],"refTable":"c",
    "refColumns":["id"]}'
A '{"action":"db-fk-drop","db":"studio_probe","table":"t","name":"fk_c"}'
A '{"action":"db-column-save","db":"studio_probe","table":"t","column":null,
    "definition":{"name":"extra","type":"int unsigned","nullable":true,"value":"value",
        "preset":"7","comment":"x"},
    "after":"name"}'
A '{"action":"db-column-move","db":"studio_probe","table":"t","column":"extra","after":"first"}'
A '{"action":"db-column-drop","db":"studio_probe","table":"t","column":"extra"}'
A '{"action":"db-table-change","db":"studio_probe","table":"t","comment":"hello"}'
A '{"action":"db-next-id","db":"studio_probe","table":"t"}'
A '{"action":"db-table-create","db":"studio_probe","name":"n","primary":true,
    "column":{"name":"id","type":"int unsigned","nullable":false,"value":"none","increment":true}}'
A '{"action":"db-table-copy","db":"studio_probe","table":"t","name":"t2","data":true}'
A '{"action":"db-table-copy","db":"studio_probe","table":"v","name":"v2"}'
A '{"action":"db-table-rename","db":"studio_probe","table":"t2","name":"t3"}'
A '{"action":"db-table-empty","db":"studio_probe","table":"t3"}'
A '{"action":"db-table-upkeep","db":"studio_probe","op":"check","tables":["t","c","v"]}'
A '{"action":"db-table-upkeep","db":"studio_probe","op":"optimize","tables":["v"]}'
A '{"action":"db-table-drop","db":"studio_probe","table":"t3"}'
A '{"action":"db-table-drop","db":"studio_probe","table":"v2"}'
A '{"action":"db-sql","db":"studio_probe",
    "sql":"SELECT id, name FROM t ORDER BY id; SELECT COUNT(*) FROM c; UPDATE c SET name = name"}'
A '{"action":"db-sql","db":"studio_probe","sql":"SELECT * FROM nope"}'

# The exports.
D '{"action":"db-export","db":"studio_probe","format":"csv","table":"t","filters":"[]"}'
D '{"action":"db-export","db":"studio_probe","format":"json","tables":["t","c","v"]}'
D '{"action":"db-export","db":"studio_probe","format":"csv","tables":["t","c"]}'
D '{"action":"db-export","db":"studio_probe","format":"sql","table":"t","keys":[{"id":"1"}],
    "structure":false}'
D '{"action":"db-export","db":"studio_probe","format":"csv","sql":"SELECT name FROM t",
    "columns":["name"]}'

# The imports: a CSV into a table, and a dump.
printf 'id,name\n9,nine\n' > "$FILES/c.csv"
# With a line of names, each column to its own: {"header":true,"mapping":["id","name"]}.
SPEC="%7B%22header%22%3Atrue%2C%22mapping%22%3A%5B%22id%22%2C%22name%22%5D%7D"
curl -s -X POST -H "X-Studio: 1" --data-binary @"$FILES/c.csv" \
    "$API/api/db-import-csv?db=studio_probe&table=c&spec=$SPEC"
echo
printf 'INSERT INTO c VALUES (10,"ten");\n' > "$FILES/d.sql"
curl -s -X POST -H "X-Studio: 1" --data-binary @"$FILES/d.sql" \
    "$API/api/db-import?db=studio_probe&name=d.sql"
echo
mariadb -N -e "SELECT * FROM studio_probe.c ORDER BY id" | md5

mariadb -e "DROP DATABASE studio_probe"
