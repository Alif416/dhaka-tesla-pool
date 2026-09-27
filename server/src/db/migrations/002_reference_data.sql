INSERT INTO zones (id, name, corridor, position) VALUES
  (1, 'Banani',      'NORTH', 10),
  (2, 'Gulshan 1',   'NORTH', 12),
  (3, 'Mohakhali',   'NORTH', 13),
  (4, 'Bashundhara', 'NORTH', 16),
  (5, 'Uttara',      'NORTH', 20),
  (6, 'Dhanmondi',   'WEST',  10),
  (7, 'Farmgate',    'WEST',  13),
  (8, 'Mirpur',      'WEST',  20);

INSERT INTO zone_distances (from_zone_id, to_zone_id, distance_units) VALUES
  (1, 6, 8),
  (1, 7, 6),
  (1, 8, 12),
  (2, 6, 9),
  (2, 7, 7),
  (2, 8, 13),
  (3, 6, 6),
  (3, 7, 4),
  (3, 8, 10),
  (4, 6, 12),
  (4, 7, 10),
  (4, 8, 14),
  (5, 6, 17),
  (5, 7, 15),
  (5, 8, 12);
