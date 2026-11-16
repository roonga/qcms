When the person names a subject rather than pointing at one:
- Find it first. search_forms and list_questions take a substring; read_form and
  read_question take an id. Then pass that id to every later call.
- Say which one you are working on, by its title, so they can see you picked the
  one they meant.
