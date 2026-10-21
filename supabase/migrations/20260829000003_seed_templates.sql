-- Delete existing static questions
DELETE FROM questions;

-- Seed 20 dynamic question templates for Chapter 1 (Addition of 2-digit numbers with regrouping)
INSERT INTO questions (topic_id, grade_level, template, param_a_min, param_a_max, param_b_min, param_b_max, distractor_rules) VALUES
-- Sub-skill 1: Addition without regrouping (ones sum <= 9, tens sum <= 9)
('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 10, 45, 10, 44, '[
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "off_by_ten", "misconceptionTag": "off_by_ten", "description": "adds or subtracts 10 from correct answer"},
  {"type": "subtract_instead", "misconceptionTag": "wrong_operation", "description": "subtracts param_b from param_a"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 11, 53, 11, 44, '[
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "off_by_ten", "misconceptionTag": "off_by_ten", "description": "adds or subtracts 10 from correct answer"},
  {"type": "subtract_instead", "misconceptionTag": "wrong_operation", "description": "subtracts param_b from param_a"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 12, 35, 10, 52, '[
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "off_by_ten", "misconceptionTag": "off_by_ten", "description": "adds or subtracts 10 from correct answer"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 20, 60, 10, 39, '[
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "off_by_ten", "misconceptionTag": "off_by_ten", "description": "adds or subtracts 10 from correct answer"},
  {"type": "subtract_instead", "misconceptionTag": "wrong_operation", "description": "subtracts param_b from param_a"}
]'::jsonb),

-- Sub-skill 2: Single-digit column regrouping (ones sum > 9, tens sum <= 8)
('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 15, 49, 15, 39, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "add_regrouped_to_ones", "misconceptionTag": "add_regrouped_to_ones", "description": "adds carried 10 back to ones column"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 26, 58, 13, 29, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "add_regrouped_to_ones", "misconceptionTag": "add_regrouped_to_ones", "description": "adds carried 10 back to ones column"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 34, 67, 14, 28, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "add_regrouped_to_ones", "misconceptionTag": "add_regrouped_to_ones", "description": "adds carried 10 back to ones column"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 25, 45, 25, 45, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "add_regrouped_to_ones", "misconceptionTag": "add_regrouped_to_ones", "description": "adds carried 10 back to ones column"}
]'::jsonb),

-- Sub-skill 3: Double regrouping (ones sum > 9, tens sum > 8)
('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 45, 89, 25, 49, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "forgot_carry_hundreds", "misconceptionTag": "forget_regrouping_hundreds", "description": "forgets to add carried 100 to hundreds place"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 57, 79, 34, 48, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "forgot_carry_hundreds", "misconceptionTag": "forget_regrouping_hundreds", "description": "forgets to add carried 100 to hundreds place"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 68, 88, 23, 39, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "forgot_carry_hundreds", "misconceptionTag": "forget_regrouping_hundreds", "description": "forgets to add carried 100 to hundreds place"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"}
]'::jsonb),

-- Sub-skill 4: Word Problems
('addition_2_digit_regrouping', 2, 'Rahul has {a} blue pens and {b} red pens. How many pens does he have in all?', 15, 49, 15, 39, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "subtract_instead", "misconceptionTag": "wrong_operation", "description": "subtracts red pens from blue pens"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"}
]'::jsonb),

('addition_2_digit_regrouping', 2, 'There are {a} apples on one tree and {b} apples on another tree. How many apples are there altogether?', 25, 48, 15, 39, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "subtract_instead", "misconceptionTag": "wrong_operation", "description": "subtracts instead of adding"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"}
]'::jsonb),

('addition_2_digit_regrouping', 2, 'Riya collected {a} seashells in the morning and {b} seashells in the afternoon. How many seashells did she collect in total?', 18, 55, 13, 38, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "subtract_instead", "misconceptionTag": "wrong_operation", "description": "subtracts instead of adding"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"}
]'::jsonb),

('addition_2_digit_regrouping', 2, 'A baker made {a} chocolate chip cookies and {b} oatmeal cookies. How many cookies did the baker make in total?', 24, 49, 18, 39, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "subtract_instead", "misconceptionTag": "wrong_operation", "description": "subtracts instead of adding"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"}
]'::jsonb),

-- Sub-skill 5: Mixed Review (various param ranges with regrouping)
('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 28, 77, 18, 38, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "add_regrouped_to_ones", "misconceptionTag": "add_regrouped_to_ones", "description": "adds carried 10 back to ones column"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 35, 68, 25, 49, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "add_regrouped_to_ones", "misconceptionTag": "add_regrouped_to_ones", "description": "adds carried 10 back to ones column"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 19, 59, 19, 39, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "add_regrouped_to_ones", "misconceptionTag": "add_regrouped_to_ones", "description": "adds carried 10 back to ones column"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 39, 69, 19, 29, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "add_regrouped_to_ones", "misconceptionTag": "add_regrouped_to_ones", "description": "adds carried 10 back to ones column"}
]'::jsonb),

('addition_2_digit_regrouping', 2, '{a} + {b} = ?', 17, 47, 17, 47, '[
  {"type": "forgot_carry", "misconceptionTag": "forget_regrouping_tens", "description": "forgets to add carried 10 to tens column"},
  {"type": "off_by_one", "misconceptionTag": "off_by_one", "description": "adds or subtracts 1 from correct answer"},
  {"type": "add_regrouped_to_ones", "misconceptionTag": "add_regrouped_to_ones", "description": "adds carried 10 back to ones column"}
]'::jsonb);
