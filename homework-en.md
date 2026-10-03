# Homework: Investor Negotiation Game (English translation)

> Translated from `homework-raw.txt`, which is a voice-to-text transcript in Russian.
> The transcript contains speech-recognition errors. Where the meaning was clear from context it has been
> restored silently. Where it was garbled, a `[translator's note]` explains the most likely meaning.
>
> **Terms used in the transcript:**
> - "Jev" ("джев") is the paid decision model.
> - "Laya" ("лая") is the free alternative the lecturer recommends.
> - "Decision LLM" ("диссижен ллм") is the lecturer's name for whichever model, Jev or Laya, makes the decisions.
> - "Regular LLM" ("обычная ллм") is an ordinary text-generation LLM.

---

## Translation

Make a game in which you talk with an investor: a negotiation with an AI. I'll send you the text now. You'll need a regular LLM there as well. Let's not use Jev. If you already have Jev, or you're willing to pay for it, you can of course use it, but I'd advise the free option. In our case the option we have is Laya.

So, you need to make a game in which the player tries to close a deal with an AI character. For example, you're selling a startup to an investor at a $2 million valuation. The investor tells you: "I'm ready to invest $500K for 30%." You then have a choice: counter with $500K for 15%, accept, or decline. You play like that, the investor responds to each of your moves, and your goal is to make the sale.

Here's an example of what your application could look like. You need to store:
- the user's offers
- the investor's offers
- the conversation history (the chat)
- and so on

What questions you ask Jev is up to you. For example, you could have it answer how confident it is that the investor will accept an offer, and how the investor should react: offer more, refuse, all of that. Look into it and describe it in detail.

I'd like to focus on the **state**, because the state is essentially the architecture of how everything in your app will be organized. You'll need **2 LLMs**:

1. **LLM #1**: as I said, in this case Laya. This is the **decision LLM**; let's call it that.
2. **A regular LLM.** You'll need it to generate the reply options for the user and the model's responses. You want the chat to feel like it's between two real people. So here you'll have to generate the steps: *generate user…, LLM response, user options*.
   > [translator's note: this part of the transcript is garbled. The lecturer seems to be reading node names off a diagram, something like `generate_llm_response` → `llm_response` and `generate_user_options` → `user_options`. In the middle of it they say something like "I forgot it behaves this badly", probably about the voice recognition or a tool.]

Remember the example above: if the LLM offers you $500K, you should be shown options you can send back to the LLM, such as "offer $500K for X%", "do this", and so on. These reply options must also be **generated, not hardcoded**, and for that you'll need the regular LLM.

Why do you need the decision LLM here? There are several options. If you want a real, proper game, you can use the decision LLM as the **investor's mind**. In other words, you use it to decide what actions the investor takes.

For example, you can put a parameter in the state, named something like that, saying the investor is **greedy**. Then, when the investor is thinking about what to do, your questions take into account that he's greedy, and the LLM will generate slightly different options. If you set him as **generous**, he might give more money for a smaller percentage. If he's greedy, he'll haggle longer.

So you can experiment with what kind of investor it is. You could even **ask at the start of the game which investor the player wants to talk to**. The choices can be hardcoded, for example:
- angry
- well-fed / content
- satisfied
- greedy
- likes / dislikes certain things
- and so on

That way, when the game launches in the console, you first pick the investor from a list and then talk to him. Depending on which investor is chosen, the prompt for your decision model will be a little different. So will the prompt for the regular model: if the investor is rude, you'd want the final output to come out a bit rude too.

So you need to build a game along these lines. And please use the decision LLM **specifically for generating the investor's response**: what he will say, whether he'll agree to the terms, and so on.

I think that's the homework. What it will show you, as written at the end, is that the NPC's whole brain is built entirely around the decision LLM. Every decision, the answer to every question, and therefore the final prompt you send to the regular LLM all depend on the decision that Laya, or Jev, makes.

If you want to build a complex chain or flow, you can do that easily. First, you can send many requests **in parallel**. You don't have to ask only for the final decision. You can send parallel requests to Jev (or Laya) about what to answer and what to pay attention to. For example, how kindly and politely you addressed the investor.

For example:
- **Request 1, technical side:** one request to the decision LLM with several questions about the technical side.
- **Request 2, moral side:** for example, what if you're being asked to invest in a weapons factory?
- **Request 3, categorization:** for example, development and stakeholders. How good are the stakeholders toward the investor, specifically in terms of how they behaved, how polite they were, and so on.
  > [translator's note: "к инстилу" is unclear. Most likely "toward the investor".]

You can do all three as **parallel requests**: you have one Jev instance running and simply send three requests to it at the same time.

---

## Summary of requirements (derived from the translation)

- **Game:** the player negotiates with an AI investor NPC to sell or raise money for a startup (e.g. $2M valuation, investor opens with "$500K for 30%").
- **Player actions:** counter-offer, accept, decline. The reply options are **generated by the regular LLM**, not hardcoded.
- **State must store:** user offers, investor offers, chat history, investor personality, etc.
- **Two LLMs:**
  - **Decision LLM (Laya, free; or Jev, paid):** the investor's "brain". It decides accept/reject/counter, confidence of acceptance, and how to react.
  - **Regular LLM:** turns the decisions into natural, human-like chat replies and generates the player's reply options.
- **Investor personality:** the player picks it from a hardcoded list at game start in the console (greedy, generous, angry, content, rude…). It changes the prompts for **both** LLMs.
- **Optional / advanced:** run several decision-LLM evaluations in parallel (technical merit, ethics/morality, stakeholder behavior and politeness) and combine them into the investor's decision.

---

## Tutor's notes (translated)

A console game where the player tries to close a deal with an AI character. For example:

```text
=== NEGOTIATION ===
You are selling a startup to an investor.
Current valuation: €2.0M
Investor:
"I'm ready to invest €500k for 30% of the company."
Your move:
> Offer €500k for 15%
```

The AI must decide how to react to the offer, but it doesn't have to generate the reply itself.

Example state:

```json
{
  "player_offer": {
    "investment": 500000,
    "equity": 15
  },
  "investor": {
    "budget": 700000,
    "max_equity": 30,
    "interest": 0.72,
    "patience": 3
  },
  "history": [
    "Investor offered €500k for 30%",
    "Player rejected"
  ]
}
```

And the Jev questions:

```json
{
  "accept": {
    "type": "score",
    "instructions": "How likely is the investor to accept the player's offer?",
    "criteria": [
      "Definitely reject",
      "Probably reject",
      "Uncertain",
      "Probably accept",
      "Definitely accept"
    ]
  },
  "reaction": {
    "type": "choice",
    "instructions": "How should the investor react?",
    "criteria": {
      "accept": "Accept the offer",
      "counter": "Make a counter-offer",
      "reject": "Reject the offer",
      "walk_away": "End the negotiation"
    }
  },
  "good_deal": {
    "type": "noul",
    "instructions": "The player's offer is attractive enough for the investor"
  }
}
```

The LLM can be used only for the text:

```text
Jev:
    reaction = counter
    accept = 2/5
        ↓
LLM:
    "Interesting offer, but 15% for €500k is too little for me.
     I can offer €500k for 22%."
```

So the architecture is very clear:

```text
                GAME STATE
                     │
                     ▼
                   JEV
             ┌───────┼───────┐
             │       │       │
          accept   reaction  good_deal
             │       │       │
             └───────┼───────┘
                     ▼
                    LLM
                     │
                     ▼
              AI reply text
                     │
                     ▼
                  PLAYER
```

This allows a very interesting mechanic: Jev is effectively the NPC's brain, and the LLM is its voice.
