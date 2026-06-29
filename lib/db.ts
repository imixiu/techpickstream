import * as mysql from "mysql2/promise";

export const SITE = "techpickstream";

function getConnectionConfig() {
  const url = process.env.MYSQL_URL;
  if (!url) throw new Error("MYSQL_URL is not set");
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || "3306"),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    connectTimeout: 10000,
    disableEval: true,
  };
}

export async function query(text: string, params: unknown[] = []) {
  const conn = await mysql.createConnection(getConnectionConfig());
  try {
    const [rows] = await conn.query(text, params);
    if (Array.isArray(rows)) {
      return rows.map((row: any) => ({ ...row }));
    }
    return rows;
  } finally {
    await conn.end();
  }
}
