import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Batch operations table - for tracking batch execution
  await knex.schema.createTable('batch_operations', (table) => {
    table.increments('id').primary();
    table.string('batch_id').unique().notNullable();
    table.integer('total_operations').notNullable();
    table.integer('completed_operations').defaultTo(0);
    table.integer('failed_operations').defaultTo(0);
    table.enum('status', ['pending', 'executing', 'completed', 'failed', 'partial']).defaultTo('pending');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('completed_at').nullable();
    table.text('operations_data').nullable(); // JSON data for operations
    
    table.index(['batch_id']);
    table.index(['status']);
    table.index(['created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('batch_operations');
}