import {
  helper,
  getSetArgs,
  escapeName,
  transformDatabaseSession
} from "../utils";

import { Client, neon } from "@neondatabase/serverless";

import type { DatabaseSession } from "../utils";
import type { Adapter, InitializeAdapter, UserSchema, KeySchema } from "lucia";
import type { DatabaseError, NeonQueryFunction, QueryResultRow } from "@neondatabase/serverless";
type TableWithSession = { user: string, session: string, key: string };
type TableWithoutSession = { user: string, key: string };
type Tables = TableWithSession | TableWithoutSession;

export const neonAdapter = (
  connectionUrl: string,
  tables: Tables
): InitializeAdapter<Adapter> => {
  const transaction = async (
    execute: (connection: Client) => Promise<any>
  ): Promise<void> => {
    const client = new Client(connectionUrl);
    await client.connect();
    try {
      await client.query("BEGIN");
      await execute(client);
      await client.query("COMMIT");
    } catch (e) {
      client.query("ROLLBACK");
      throw e;
    } finally { await client.end() }
  };

  const ESCAPED_USER_TABLE_NAME = escapeName(tables.user);
  const ESCAPED_SESSION_TABLE_NAME = (tables as TableWithSession)?.session
    ? escapeName((tables as TableWithSession)?.session)
    : null;
  const ESCAPED_KEY_TABLE_NAME = escapeName(tables.key);

  const sql = neon(connectionUrl);

  return (LuciaError) => {
    return {
      getUser: async (userId) => {
        const result = await get<UserSchema>(
          sql(`SELECT * FROM ${ESCAPED_USER_TABLE_NAME} WHERE id = $1`, [
            userId
          ])
        );
        return result;
      },
      setUser: async (user, key) => {
        if (!key) {
          const [userFields, userValues, userArgs] = helper(user);
          await sql(
            `INSERT INTO ${ESCAPED_USER_TABLE_NAME} ( ${userFields} ) VALUES ( ${userValues} )`,
            userArgs
          );
          return;
        }
        try {
          await transaction(async (client: Client) => {
            const [userFields, userValues, userArgs] = helper(user);
            await client.query(
              `INSERT INTO ${ESCAPED_USER_TABLE_NAME} ( ${userFields} ) VALUES ( ${userValues} )`,
              userArgs
            );
            const [keyFields, keyValues, keyArgs] = helper(key);
            await client.query(
              `INSERT INTO ${ESCAPED_KEY_TABLE_NAME} ( ${keyFields} ) VALUES ( ${keyValues} )`,
              keyArgs
            );
          });
        } catch (e) {
          const error = e as Partial<DatabaseError>;
          if (error.code === "23505" && error.detail?.includes("Key (id)")) {
            throw new LuciaError("AUTH_DUPLICATE_KEY_ID");
          }
          throw e;
        }
      },
      deleteUser: async (userId) => {
        await sql(
          `DELETE FROM ${ESCAPED_USER_TABLE_NAME} WHERE id = $1`,
          [userId]
        );
      },
      updateUser: async (userId, partialUser) => {
        const [fields, values, args] = helper(partialUser);
        await sql(
          `UPDATE ${ESCAPED_USER_TABLE_NAME} SET ${getSetArgs(
            fields,
            values
          )} WHERE id = $${fields.length + 1}`,
          [...args, userId]
        );
      },

      getSession: async (sessionId) => {
        if (!ESCAPED_SESSION_TABLE_NAME) {
          throw new Error("Session table not defined");
        }
        const result = await get<DatabaseSession>(
          sql(
            `SELECT * FROM ${ESCAPED_SESSION_TABLE_NAME} WHERE id = $1`,
            [sessionId]
          )
        );
        return result ? transformDatabaseSession(result) : null;
      },
      getSessionsByUserId: async (userId) => {
        if (!ESCAPED_SESSION_TABLE_NAME) {
          throw new Error("Session table not defined");
        }
        const result = await getAll<DatabaseSession>(
          sql(
            `SELECT * FROM ${ESCAPED_SESSION_TABLE_NAME} WHERE user_id = $1`,
            [userId]
          )
        );
        return result.map((val) => transformDatabaseSession(val));
      },
      setSession: async (session) => {
        if (!ESCAPED_SESSION_TABLE_NAME) {
          throw new Error("Session table not defined");
        }
        try {
          const [fields, values, args] = helper(session);
          await sql(
            `INSERT INTO ${ESCAPED_SESSION_TABLE_NAME} ( ${fields} ) VALUES ( ${values} )`,
            args
          );
        } catch (e) {
          const error = e as Partial<DatabaseError>;
          if (
            error.code === "23503" &&
            error.detail?.includes("Key (user_id)")
          ) {
            throw new LuciaError("AUTH_INVALID_USER_ID");
          }
          throw e;
        }
      },
      deleteSession: async (sessionId) => {
        if (!ESCAPED_SESSION_TABLE_NAME) {
          throw new Error("Session table not defined");
        }
        await sql(
          `DELETE FROM ${ESCAPED_SESSION_TABLE_NAME} WHERE id = $1`,
          [sessionId]
        );
      },
      deleteSessionsByUserId: async (userId) => {
        if (!ESCAPED_SESSION_TABLE_NAME) {
          throw new Error("Session table not defined");
        }
        await sql(
          `DELETE FROM ${ESCAPED_SESSION_TABLE_NAME} WHERE user_id = $1`,
          [userId]
        );
      },
      updateSession: async (sessionId, partialSession) => {
        if (!ESCAPED_SESSION_TABLE_NAME) {
          throw new Error("Session table not defined");
        }
        const [fields, values, args] = helper(partialSession);
        await sql(
          `UPDATE ${ESCAPED_SESSION_TABLE_NAME} SET ${getSetArgs(
            fields,
            values
          )} WHERE id = $${fields.length + 1}`,
          [...args, sessionId]
        );
      },

      getKey: async (keyId) => {
        const result = await get(
          sql(
            `SELECT * FROM ${ESCAPED_KEY_TABLE_NAME} WHERE id = $1`,
            [keyId]
          )
        );
        return result as Promise<KeySchema | null>;
      },
      getKeysByUserId: async (userId) => {
        const result = getAll<KeySchema>(
          sql(
            `SELECT * FROM ${ESCAPED_KEY_TABLE_NAME} WHERE user_id = $1`,
            [userId]
          )
        );
        return result;
      },
      setKey: async (key) => {
        try {
          const [fields, values, args] = helper(key);
          await sql(
            `INSERT INTO ${ESCAPED_KEY_TABLE_NAME} ( ${fields} ) VALUES ( ${values} )`,
            args
          );
        } catch (e) {
          const error = e as Partial<DatabaseError>;
          if (
            error.code === "23503" &&
            error.detail?.includes("Key (user_id)")
          ) {
            throw new LuciaError("AUTH_INVALID_USER_ID");
          }
          if (error.code === "23505" && error.detail?.includes("Key (id)")) {
            throw new LuciaError("AUTH_DUPLICATE_KEY_ID");
          }
          throw e;
        }
      },
      deleteKey: async (keyId) => {
        await sql(
          `DELETE FROM ${ESCAPED_KEY_TABLE_NAME} WHERE id = $1`,
          [keyId]
        );
      },
      deleteKeysByUserId: async (userId) => {
        await sql(
          `DELETE FROM ${ESCAPED_KEY_TABLE_NAME} WHERE user_id = $1`,
          [userId]
        );
      },
      updateKey: async (keyId, partialKey) => {
        const [fields, values, args] = helper(partialKey);
        await sql(
          `UPDATE ${ESCAPED_KEY_TABLE_NAME} SET ${getSetArgs(
            fields,
            values
          )} WHERE id = $${fields.length + 1}`,
          [...args, keyId]
        );
      },

      getSessionAndUser: async (sessionId) => {
        if (!ESCAPED_SESSION_TABLE_NAME) {
          throw new Error("Session table not defined");
        }
        const getSessionPromise = get(
          sql(
            `SELECT * FROM ${ESCAPED_SESSION_TABLE_NAME} WHERE id = $1`,
            [sessionId]
          )
        );
        const getUserFromJoinPromise = get(
          sql<
            UserSchema & {
              __session_id: string;
            }
          >(
            `SELECT ${ESCAPED_USER_TABLE_NAME}.*, ${ESCAPED_SESSION_TABLE_NAME}.id as __session_id FROM ${ESCAPED_SESSION_TABLE_NAME} INNER JOIN ${ESCAPED_USER_TABLE_NAME} ON ${ESCAPED_USER_TABLE_NAME}.id = ${ESCAPED_SESSION_TABLE_NAME}.user_id WHERE ${ESCAPED_SESSION_TABLE_NAME}.id = $1`,
            [sessionId]
          )
        );
        const [sessionResult, userFromJoinResult] = await Promise.all([
          getSessionPromise,
          getUserFromJoinPromise
        ]);
        if (!sessionResult || !userFromJoinResult) return [null, null];
        const { __session_id: _, ...userResult } = userFromJoinResult;
        return [transformDatabaseSession(sessionResult as DatabaseSession), userResult];
      }
    };
  };
};

export const get = async <_Schema extends QueryResultRow>(
  queryPromise: Promise<any>
): Promise<_Schema | null> => {
  const rows = await queryPromise;
  const result = rows.at(0) ?? null;
  return result;
};

export const getAll = async <_Schema extends QueryResultRow>(
  queryPromise: Promise<any>
): Promise<_Schema[]> => {
  const rows = await queryPromise;
  return rows;
};