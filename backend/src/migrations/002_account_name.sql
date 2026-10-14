-- nickname chosen at signup; device accounts and older email accounts have none
ALTER TABLE accounts ADD COLUMN name TEXT;
