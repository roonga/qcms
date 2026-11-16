# A money amount

**Use for:** an amount claimed, a charge, an income, a deduction, a worksheet figure.

**Settings**

- `number`, `constraints.integer: false`, `constraints.min: 0` and a `constraints.max` the form can defend.
- Name the currency in the label or in `help`, as in "Amount claimed, in Australian dollars". Nothing else records it.
- `help` saying how to enter it: digits and a decimal point, no currency sign and no thousands separator.
- `messages.min` and `messages.max` in the form's own words.

**Cannot be expressed**

- Two decimal places. Nothing limits the number of decimals, so a response can carry three or more.
- A currency on the answer. The amount is a bare number.
- A currency symbol, a thousands separator, or any display formatting.
- A total added up from other answers. No question is calculated, and a worksheet total has to be typed in.

**Say this**

> It takes a plain number with a minimum of zero and a ceiling. Two things it will not do: it does not hold the amount to two decimal places, and it does not add anything up. Where the source form works a total out, the person filling it in has to do the sum and type the answer.

**Corpus sources:** US health insurance claim CMS-1500 (monetary amounts across six service lines), US tax withholding W-4 (currency inputs and arithmetic worksheet outputs), US American Community Survey (money fields), Australian national private patient hospital claim (charges), ahm travel insurance claim (itemized losses).
