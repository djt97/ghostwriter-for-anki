const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { checkCard, plainText, sentenceCount, listItemCount } = require('../../card-checks.js');

const ids = (card) => checkCard(card).map((flag) => flag.id);

describe('card checks: fronts', () => {
  it('flags a yes/no question', () => {
    assert.deepEqual(ids({ front: 'Is every Lévy process a semimartingale?', back: 'Yes.' }), ['yes-no']);
  });

  it('flags a coin-flip between two alternatives', () => {
    assert.ok(ids({ front: 'Does each state elect one or two senators?', back: 'Two' }).includes('two-alternatives'));
    // An "or" inside the question is often harmless ("the mean or expected value").
    assert.ok(!ids({ front: 'What is the mean or expected value of a fair die roll?', back: '3.5' }).includes('two-alternatives'));
  });

  it('flags empty frames and essay commands', () => {
    assert.ok(ids({ front: 'What role does trust play in markets?', back: 'It lowers transaction costs.' }).includes('empty-frame'));
    assert.ok(ids({ front: 'What is the relationship between interest rates and bond prices?', back: 'They move in opposite directions.' }).includes('empty-frame'));
    assert.ok(ids({ front: 'Explain the Iverson bracket.', back: '1 if true, 0 if false.' }).includes('open-command'));
  });

  it('flags vague cues and one-sided comparisons', () => {
    assert.ok(ids({ front: 'Intuitively, why is space easier than time?', back: 'Space can be reused.' }).includes('vague-cue'));
    assert.ok(ids({ front: 'What distinguishes organic solidarity?', back: 'Interdependence.' }).includes('one-sided-comparison'));
    assert.ok(!ids({ front: 'What distinguishes organic solidarity from mechanical solidarity?', back: 'Interdependence rather than resemblance.' }).includes('one-sided-comparison'));
  });

  it('flags a question that depends on something not on the card', () => {
    assert.ok(ids({ front: 'Why does it converge?', back: 'Because the map is a contraction.' }).includes('cold-start'));
    assert.ok(!ids({ front: 'What is it called when a market has one buyer?', back: 'Monopsony' }).includes('cold-start'));
    // A dummy "it" points at nothing.
    assert.ok(!ids({ front: 'Why is it important to have methods for unsupervised learning tasks?', back: 'Unlabeled data is more abundant.' }).includes('cold-start'));
    assert.ok(!ids({ front: 'How is it that ice floats on water?', back: 'Ice is less dense than water.' }).includes('cold-start'));
    assert.ok(ids({ front: 'Why is it bounded?', back: 'It is continuous on a compact set.' }).includes('cold-start'));
    assert.ok(ids({ front: 'Why does it converge to a fixed point?', back: 'The map is a contraction.' }).includes('cold-start'));
  });

  it('flags an answer that already sits on the front', () => {
    assert.ok(ids({ front: 'Which effect, the spacing effect, makes spaced reviews work?', back: 'The spacing effect' }).includes('answer-on-front'));
    assert.ok(!ids({ front: 'Reviewing just before you would forget exploits which effect?', back: 'The spacing effect' }).includes('answer-on-front'));
    assert.ok(!ids({ front: 'Which quantity do we introduce to solve the recurrence?', back: 'Define \\(S_n\\).' }).includes('answer-on-front'));
  });

  it('leaves well-built questions alone', () => {
    for (const card of [
      { front: 'In \'The Road Not Taken\', what has \'made all the difference\'?', back: 'Taking the road \'less traveled by\'.' },
      { front: 'Reviewing a card just before you would forget it exploits which effect?', back: 'The spacing effect.' },
      { front: 'Write the degree-matrix form of the Laplacian matrix \\(L\\).', back: '\\(L = D - A\\)' },
      { front: 'Mechanical solidarity is solidarity by...', back: 'Resemblance' },
    ]) {
      assert.deepEqual(checkCard(card), [], JSON.stringify(card));
    }
  });
});

describe('card checks: backs', () => {
  it('notes a back with two facts, softly', () => {
    const flag = checkCard({ front: 'What is the Dunning-Kruger effect?', back: 'Unskilled people overrate their ability. Experts tend to underrate theirs.' }).find((f) => f.id === 'two-facts');
    assert.equal(flag.severity, 'note');
    assert.match(flag.message, /^The back may hold more than one fact/);
  });

  it('flags a back with two facts', () => {
    assert.ok(ids({ front: 'What is the Dunning-Kruger effect?', back: 'Unskilled people overrate their ability. Experts tend to underrate theirs.' }).includes('two-facts'));
    assert.ok(ids({ front: 'What is a monopsony?', back: 'A market with one buyer; it pays below marginal product.' }).includes('two-facts'));
  });

  it('allows a two-part back that the front announces', () => {
    assert.ok(!ids({ front: 'What two characteristics define X?', back: 'It is sacred. It is set apart.' }).includes('two-facts'));
    assert.ok(!ids({ front: 'How do segments differ from organs?', back: 'Segments could survive on their own; organs could not.' }).includes('two-facts'));
  });

  it('flags lists, and long lists even when the front asks for them', () => {
    assert.ok(ids({ front: 'What made up the Bauhaus curriculum?', back: 'Craft, form, colour, and materials.' }).includes('list-back'));
    assert.ok(ids({ front: 'What four elements made up the Bauhaus curriculum?', back: 'Craft training, the study of form, colour theory, and work with materials.' }).includes('list-back'));
    assert.ok(!ids({ front: 'What are the three levels of supervision in deep learning?', back: 'supervised, semi-supervised, and unsupervised' }).includes('list-back'));
  });

  it('flags alternative names and notes a long back', () => {
    assert.ok(ids({ front: 'What do we call a function bounded on compacts?', back: 'Locally bounded (also called bounded on compacts)' }).includes('alternate-forms'));
    const long = checkCard({ front: 'What does the planning fallacy describe?', back: 'People tend to underestimate how long their own tasks will take even when similar tasks have run late before.' });
    assert.deepEqual(long.map((f) => [f.id, f.severity]), [['long-back', 'note']]);
  });

  it('reads abbreviations and math without splitting sentences', () => {
    assert.equal(sentenceCount('Smith v. Jones, High Court of Australia.'), 1);
    assert.equal(sentenceCount('See e.g. the proof.'), 1);
    assert.equal(plainText('<b>The</b> map \\(x \\mapsto x^2.\\) is convex. ^1700000000001'), 'The map MATH is convex.');
    assert.equal(listItemCount('1. Define the class.\n2. Show it is closed.'), 2);
  });
});
