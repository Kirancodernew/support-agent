import { model, Schema } from 'mongoose';

const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } });

const CounterModel = model('Counter', counterSchema);

/**
 * Next number in a named sequence, e.g. a workspace's ticket numbers. One atomic $inc, so two
 * tickets created at the same moment can never get the same number (unlike count() + 1).
 */
export async function nextSequence(name: string) {
  const counter = await CounterModel.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return counter.seq;
}
