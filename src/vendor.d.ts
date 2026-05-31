declare module 'bcryptjs' {
  export function hash(data: string, salt: string): Promise<string>;

  const bcrypt: {
    hash: typeof hash;
  };

  export default bcrypt;
}
